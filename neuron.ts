// ============================================================
//  NEURON  --  flash this UNCHANGED onto every neuron board.
//
//  The board learns who it is from the sender: sender.ts holds a table of
//  micro:bit serial number -> neuron name and radios each board its identity,
//  its weights and its bias. Nothing in this file is per-board, so all five
//  boards run the same hex.
//
//  Values between neurons travel over softSerial cables:
//      inputs  <- P0, P1, P2      (one wire per incoming neuron)
//      output  -> P3              (to the next layer's input pins)
//  Wire h0.P3 -> y*.P0, h1.P3 -> y*.P1, h2.P3 -> y*.P2, and give the
//  boards a common ground. The slot a value lands in is decided by the PIN,
//  so the wiring order must match the weight order the training page exported.
//
//  Radio protocol (see sender.ts):
//      STRING "<serial>=<name>"  claims THIS board if the serial matches,
//                                e.g. "139422584=h0". Sent as a STRING because
//                                radio.sendValue()'s number is a 32-bit float,
//                                which cannot hold a 9-10 digit serial exactly.
//      "<name>i"    value = fanIn           e.g. "y0i"  = 3
//      "<name>b"    value = bias            e.g. "h1b"  = 10.15
//      "<name>w<j>" value = weight j        e.g. "h1w0" = -11.38
//      "calc"                               start a round
//      "reset"                              clear inputs, keep weights
//
//  INPUT (x) boards use the same file. They have no weights; instead the
//  sender gives them a list of selectable values, each with a picture:
//      "<name>n"    value = how many choices        e.g. "x0n" = 4
//      "<name>v<k>" value = choice k's value        e.g. "x0v0" = 0.25
//      STRING "<name>p<k>:<25 chars>"  choice k's picture, row by row,
//                                      e.g. "x0p0:0111010001001000100001110"
//  A is previous choice, B is next; the board shows that choice's picture and
//  sends its value on P3 when "calc" arrives.
// ============================================================

// Status is shown on the RGB LED rather than the 5x5 matrix. Not because the
// matrix conflicts with the pins -- on the Calliope mini P0-P3 are independent
// of the display -- but because matrix output (showString/showImage/showNumber)
// SCROLLS AND BLOCKS, and a blocked board misses arriving softSerial lines
// outright. RGB colours are instant.

// The sender uses the same group; without this the board is on group 0 and
// never hears a thing.
//
// NOTE: this runs BEFORE the softSerial.onLine registrations further down.
// The older working code (nn.js) never initialised the radio at all, and its
// cables worked. Radio and bit-banged softSerial compete for timing, so if
// reception stays dead, test with softserial-test.ts: it is softSerial only,
// with a commented-out setGroup to toggle. If the radio proves to be the
// conflict, the fix is to keep them apart rather than reorder these lines.
radio.setGroup(1)

// ---- identity, assigned over radio -------------------------------------
let ownName = ""          // "h0".."h2", "y0", "y1" -- empty until the sender says
let fanIn = 0             // how many inputs this neuron waits for
let bias = 0
let ownWeights: number[] = [0, 0, 0, 0]
let weightsSeen: boolean[] = [false, false, false, false]
let biasSeen = false
let fanInSeen = false

// ---- input (x) boards only ---------------------------------------------
// An x board has no weights. It holds a list of selectable values, each with a
// picture, and sends the selected one when a round starts.
let choiceValues: number[] = []
let choiceValuesSeen: boolean[] = []
// Set by the radio handlers, acted on by the main loop. Drawing must NEVER
// happen inside a radio handler: basic.showNumber/showString scroll and block
// for hundreds of ms, during which arriving packets overflow the radio queue
// and are dropped -- that is what made one choice never arrive.
let displayDirty = false
let choiceImages: Image[] = []
let choiceCount = 0
let choiceIndex = 0

// ---- per-round input state ---------------------------------------------
// received[i] tracks whether inputs[i] has ARRIVED this round. A neuron can
// legitimately send 0.0, so the value itself can never mean "nothing yet".
let inputs: number[] = [0, 0, 0, 0]
let received: boolean[] = [false, false, false, false]
let armed = false         // true between a "calc" request and this neuron firing
let output = 0

// ============================================================
//  Maths
// ============================================================
function sigmoid(num: number): number {
    // Clamp first: weights reach +-16, so num can reach about +-40 and
    // Math.exp() would overflow to Infinity on the way to a value that is
    // flat 0 or 1 anyway.
    let z = num
    if (z > 30) {
        z = 30
    }
    if (z < -30) {
        z = -30
    }
    return 1 / (1 + Math.exp(0 - z))
}

function getNeuronOutput(): number {
    let result = 0
    for (let i = 0; i <= fanIn - 1; i++) {
        result = result + inputs[i] * ownWeights[i]
    }
    result = result + bias
    return sigmoid(result)
}

function isInputBoard(): boolean {
    return ownName.charAt(0) == "x"
}

// All status goes through the RGB LED: the 5x5 matrix is disabled because it
// would steal the softSerial pins. Colours are instant and never block.
function setRgb(r: number, g: number, b: number) {
    basic.setLedColors((r << 16) | (g << 8) | b, 0, 0)
}
function rgbOff() {
    basic.turnRgbLedOff()
}
// Brief flash without blocking long enough to lose a serial line.
function flash(r: number, g: number, b: number) {
    setRgb(r, g, b)
    basic.pause(60)
    rgbOff()
}

function hasChoice(k: number): boolean {
    return k >= 0 && k < choiceValuesSeen.length && choiceValuesSeen[k]
}

// Draw the picture for the currently selected choice, the number if no picture
// arrived, or "!" if the value itself never arrived (a dropped radio message).
// Draw the current state. NON-BLOCKING on purpose -- showImage(0) and
// plotting are instant, whereas showNumber/showString scroll for a long time
// and would stall the radio. Called only from the main loop, never a handler.
// NOTE: the per-choice PICTURES cannot be shown while the matrix is disabled.
// They are still received and stored (choiceImages), so if the display is ever
// re-enabled -- e.g. on a board that does no softSerial reading -- showImage
// can come back. For now the selected choice is shown as an RGB colour:
// blue -> green -> yellow -> red across the list.
function showChoice() {
    if (ownName == "") {
        setRgb(40, 0, 40)                  // purple: unclaimed
        return
    }
    if (!hasChoice(choiceIndex)) {
        setRgb(60, 0, 0)                   // red: this choice never arrived
        return
    }
    if (choiceCount <= 1) {
        setRgb(0, 0, 60)
        return
    }
    // Spread the selection across blue -> red so each choice looks distinct.
    let t = Math.idiv(choiceIndex * 255, choiceCount - 1)
    setRgb(t, 60 - Math.idiv(t, 4), 60 - t)
}

// Report the selection to serial, saying plainly when a value is missing
// instead of printing "undefined".
function reportChoice() {
    if (hasChoice(choiceIndex)) {
        serial.writeValue("sel_" + ownName, choiceValues[choiceIndex])
    } else {
        serial.writeLine("sel_" + ownName + ": MISSING (choice " + choiceIndex +
            " never arrived -- press A on the sender again)")
    }
}

// Turn a 25-character "0"/"1" string into an Image, row by row.
function imageFromText(bits: string): Image {
    let img = images.createImage(`
        . . . . .
        . . . . .
        . . . . .
        . . . . .
        . . . . .
        `)
    for (let y = 0; y <= 4; y++) {
        for (let x = 0; x <= 4; x++) {
            if (bits.charAt(y * 5 + x) == "1") {
                img.setPixel(x, y, true)
            }
        }
    }
    return img
}

// ============================================================
//  Readiness
// ============================================================
function isConfigured(): boolean {
    if (ownName == "") {
        return false
    }
    // An x board needs choices, not weights.
    if (isInputBoard()) {
        if (choiceCount <= 0) {
            return false
        }
        // Radio is unacknowledged: a dropped "<name>v<k>" leaves a hole, and
        // stepping onto it would send undefined into the network.
        for (let k = 0; k <= choiceCount - 1; k++) {
            if (k >= choiceValuesSeen.length || !choiceValuesSeen[k]) {
                return false
            }
        }
        return true
    }
    if (!fanInSeen || !biasSeen) {
        return false
    }
    for (let i = 0; i <= fanIn - 1; i++) {
        if (!weightsSeen[i]) {
            return false
        }
    }
    return true
}

function hasAllInputs(): boolean {
    for (let i = 0; i <= fanIn - 1; i++) {
        if (!received[i]) {
            return false
        }
    }
    return true
}

function clearRound() {
    for (let i = 0; i <= 3; i++) {
        inputs[i] = 0
        received[i] = false
    }
    armed = false
}

// ============================================================
//  Radio: identity, parameters and the calculate request
// ============================================================
radio.onReceivedValue(function (name, value) {
    // Broadcasts meant for everyone.
    if (name == "calc") {
        // Do NOT clear inputs here. An x board may already have sent its value
        // before this board processed its own "calc" -- clearing would wipe a
        // value that had already arrived, and the board would then wait forever
        // for something already delivered. Inputs are cleared on COMPLETION
        // (clearRound after firing), so a round starts clean regardless.
        armed = true
        return
    }
    if (name == "reset") {
        clearRound()
        return
    }

    // Everything else is "<neuronName><field>", e.g. "h1w0", "y0b", "y0i".
    // Names are 2 chars, so the field starts at index 2.
    if (name.length < 3) {
        return
    }
    let target = name.substr(0, 2)
    let field = name.substr(2, name.length - 2)

    // Ignore anything addressed to another neuron, and everything at all
    // until the sender has told us who we are.
    if (ownName == "" || target != ownName) {
        return
    }

    if (field == "i") {
        fanIn = value
        fanInSeen = true
        return
    }
    if (field == "n") {
        // x board: how many selectable choices. Starting a new list clears the
        // old one, so a re-push cannot leave stale values behind.
        choiceCount = value
        choiceIndex = 0
        choiceValues = []
        choiceValuesSeen = []
        choiceImages = []
        return
    }
    if (field == "b") {
        bias = value
        biasSeen = true
        return
    }
    if (field.charAt(0) == "v") {
        // x board: choice k's value
        let k = parseInt(field.substr(1, field.length - 1))
        while (choiceValues.length <= k) {
            choiceValues.push(0)
            choiceValuesSeen.push(false)
        }
        choiceValues[k] = value
        choiceValuesSeen[k] = true
        if (k == choiceIndex) {
            displayDirty = true
        }
        return
    }
    if (field.charAt(0) == "w") {
        let j = parseInt(field.substr(1, field.length - 1))
        if (j >= 0 && j <= 3) {
            ownWeights[j] = value
            weightsSeen[j] = true
        }
    }
})

// ONE handler for every radio string. There must only ever be one:
// registering radio.onReceivedString twice REPLACES the first registration,
// so a second handler silently kills identity assignment.
//
// Two message shapes arrive here:
//   "<serial>=<name>"              identity, e.g. "-2022602061=x0"
//   "<name>p<k>:<25 chars>"        an x board's picture for choice k
// Both travel as text because neither a serial number nor a 25-pixel mask
// survives radio.sendValue()'s 32-bit float (exact only to 2^24).
radio.onReceivedString(function (receivedString) {
    let colon = receivedString.indexOf(":")

    // ---- picture: "<name>p<k>:<bits>" ----
    if (colon >= 0) {
        let head = receivedString.substr(0, colon)
        let bits = receivedString.substr(colon + 1, receivedString.length - colon - 1)
        if (head.length < 4 || bits.length < 25) {
            return
        }
        if (head.substr(0, 2) != ownName || head.charAt(2) != "p") {
            return
        }
        let k = parseInt(head.substr(3, head.length - 3))
        while (choiceImages.length <= k) {
            choiceImages.push(null)
        }
        choiceImages[k] = imageFromText(bits)
        if (k == choiceIndex) {
            displayDirty = true
        }
        return
    }

    // ---- identity: "<serial>=<name>" ----
    let eq = receivedString.indexOf("=")
    if (eq < 0) {
        return
    }
    let wantSerial = receivedString.substr(0, eq)
    let wantName = receivedString.substr(eq + 1, receivedString.length - eq - 1)
    if (wantSerial == convertToText(control.deviceSerialNumber())) {
        ownName = wantName
        displayDirty = true
    } else if (ownName == wantName) {
        // This name now belongs to a different board -- let it go.
        ownName = ""
        displayDirty = true
    }
})

// ============================================================
//  softSerial: one incoming value per pin
// ============================================================
// Each handler logs the RAW line first, so the serial monitor shows whether
// anything reaches the pin at all -- that separates "nothing on the wire"
// (wiring/ground/baud) from "arrived but rejected" (parsing).
//
// The leading basic.pause(10) is copied from the older working version of this
// code (nn.js). It was dropped in the rewrite and the link stopped delivering,
// so treat it as load-bearing: it yields briefly so the bit-banged softSerial
// driver can settle before the handler runs.
//
// Registration order also matches nn.js (P1, P2, then P0), which is the order
// that was observed working.
// Visual feedback: a received value lights a pixel in the middle row --
// column 0 for P0, 1 for P1, 2 for P2 -- so you can see arrivals without a
// serial monitor attached. led.plot is instant; nothing here may scroll.
// The dots stay lit until the board fires (clearRound wipes them).
softSerial.onLine(DigitalPin.P1, softSerial.BaudRate.Baud1200, function (line) {
    basic.pause(10)
    serial.writeLine("RX P1 raw: [" + line + "]")
    inputs[1] = parseFloat(line)
    received[1] = true
    flash(0, 60, 0)                     // green flash = a value arrived
})
softSerial.onLine(DigitalPin.P2, softSerial.BaudRate.Baud1200, function (line) {
    basic.pause(10)
    serial.writeLine("RX P2 raw: [" + line + "]")
    inputs[2] = parseFloat(line)
    received[2] = true
    flash(0, 60, 0)
})
softSerial.onLine(DigitalPin.P0, softSerial.BaudRate.Baud1200, function (line) {
    basic.pause(10)
    serial.writeLine("RX P0 raw: [" + line + "]")
    inputs[0] = parseFloat(line)
    received[0] = true
    flash(0, 60, 0)
})

// ============================================================
//  Main loop: fire once per round, when every input has arrived
// ============================================================
basic.forever(function () {
    basic.pause(20)
    // Repaint here, outside the radio handlers, so drawing never stalls the
    // radio queue.
    if (displayDirty) {
        displayDirty = false
        if (isInputBoard()) {
            showChoice()
        } else if (ownName == "") {
            setRgb(40, 0, 40)              // purple = unclaimed
        } else if (ownName.charAt(0) == "y") {
            setRgb(0, 0, 50)               // blue = output neuron, claimed
        } else {
            setRgb(0, 50, 20)              // teal = hidden neuron, claimed
        }
    }
    if (!armed || !isConfigured()) {
        return
    }
    // An x board produces a value instead of waiting for one: on "calc" it
    // just sends whichever choice is currently selected.
    if (isInputBoard()) {
        if (!hasChoice(choiceIndex)) {
            serial.writeLine(ownName + ": cannot send, choice " + choiceIndex +
                " is missing")
            armed = false
            return
        }
        // Receivers no longer clear on "calc", so this no longer has to win a
        // race -- a short settle is enough to let every board arm itself.
        basic.pause(50)
        output = choiceValues[choiceIndex]
        serial.writeLine("TX P3: " + output + " (from " + ownName + ")")
        softSerial.writeNumber(DigitalPin.P3, softSerial.BaudRate.Baud1200, output)
        armed = false
        return
    }
    if (!hasAllInputs()) {
        return
    }
    output = getNeuronOutput()
    serial.writeValue("out_" + ownName, output)
    setRgb(0, 0, 60)                    // blue = transmitting
    softSerial.writeNumber(DigitalPin.P3, softSerial.BaudRate.Baud1200, output)
    rgbOff()
    // Output neurons also report back, so the sender can pick the winner.
    if (ownName.charAt(0) == "y") {
        radio.sendValue(ownName + "o", output)
    }
    clearRound()
})

// ============================================================
//  Button B: dump this board's state to serial (read-only)
// ============================================================
input.onButtonEvent(Button.A, input.buttonEventClick(), function () {
    // On an x board A steps back through the choices.
    if (isInputBoard() && choiceCount > 0) {
        choiceIndex = (choiceIndex + choiceCount - 1) % choiceCount
        showChoice()
        reportChoice()
        return
    }
    // On any other board A sends a known test value on P3, so the CABLE can be
    // tested on its own: press A here, watch the downstream board's serial for
    // "RX P<n> raw: [0.5]". No radio, no calc, no weights involved.
    serial.writeLine("TX P3 test: 0.5 (from " + ownName + ")")
    setRgb(0, 0, 60)                    // blue = transmitting
    softSerial.writeNumber(DigitalPin.P3, softSerial.BaudRate.Baud1200, 0.5)
    basic.pause(200)
    rgbOff()
})

input.onButtonEvent(Button.B, input.buttonEventClick(), function () {
    // On an x board B steps to the next choice; elsewhere it dumps state.
    if (isInputBoard() && choiceCount > 0) {
        choiceIndex = (choiceIndex + 1) % choiceCount
        showChoice()
        reportChoice()
        return
    }
    serial.writeLine("--- " + (ownName == "" ? "UNCLAIMED" : ownName) + " ---")
    // Paste this line straight into boardSerials[] in sender.ts, quotes and all.
    // The serial is a SIGNED 32-bit int, so it can be negative -- keep the minus.
    serial.writeLine("    \"" + convertToText(control.deviceSerialNumber()) + "\",")
    basic.pause(50)
    serial.writeLine("serial: " + control.deviceSerialNumber())
    serial.writeValue("fanIn", fanIn)
    serial.writeValue("bias", bias)
    serial.writeLine("configured: " + isConfigured())
    for (let i = 0; i <= 3; i++) {
        serial.writeValue("w" + i, ownWeights[i])
        basic.pause(30)
    }
    for (let i = 0; i <= 3; i++) {
        serial.writeLine("in" + i + ": " + inputs[i] + "  received: " + received[i])
        basic.pause(30)
    }
})

// Show that we are up but not yet claimed. RGB only -- the matrix is disabled
// so that softSerial can use P0/P1/P2.
setRgb(40, 0, 40)
