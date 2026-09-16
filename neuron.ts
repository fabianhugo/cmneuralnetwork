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
//                                e.g. "-1394225184=h0". A STRING because
//                                radio.sendValue()'s number is a 32-bit float
//                                and cannot hold a 9-10 digit serial.
//      "<name>i"    value = fanIn           e.g. "y0i"  = 3
//      "<name>b"    value = bias            e.g. "h1b"  = 10.15
//      "<name>w<j>" value = weight j        e.g. "h1w0" = -11.38
//      "<name>t"    value = win threshold    e.g. "y0t"  = 0.5
//      "<name>cr/cg/cb" value = flash colour  e.g. "y1cr" = 40
//      STRING "<name>m<n>:<text>"  chunk n of the message an output
//                                neuron shows when it wins, e.g.
//                                "y1m0:frech". Chunk 0 replaces,
//                                later chunks append.
//      "calc"                               start a round
//
//  INPUT (x) boards use the same file. They have no weights; instead the
//  sender gives them a list of selectable values, each with a picture:
//      "<name>n"    value = how many choices        e.g. "x0n" = 4
//      "<name>v<k>" value = choice k's value        e.g. "x0v0" = 0.25
//      "<name>m"    value = mean for scaling        e.g. "x0m" = 0.625
//      "<name>s"    value = spread for scaling      e.g. "x0s" = 0.2795
//                   (0 = send the raw value)
//      STRING "<name>p<k>:<5 packed chars>"  choice k's picture, 5 bits per
//                                        character (code 95 + row value), so
//                                        all 25 pixels fit sendString's
//                                        19-character limit. e.g. "x0p0:zz___".
//  A is previous choice, B is next; the board shows that choice's picture and
//  sends its value on P3 when "calc" arrives.
//
//  Buttons on every board:
//      A    x board: previous choice.  Others: send a 0.5 test value on P3.
//      B    x board: next choice.      Others: dump state, then show the last
//                                      output again as a bar.
//      A+B  start a round for the WHOLE network (same as the sender's B),
//           so it runs without the sender being connected.
// ============================================================

// Without this the board sits on group 0 and never hears the sender.
radio.setGroup(1)

// ---- identity, assigned over radio -------------------------------------
let ownName = ""          // "h0".."h2", "y0", "y1" -- empty until the sender says
let fanIn = 0             // how many inputs this neuron waits for
let bias = 0
let ownWeights: number[] = [0, 0, 0, 0]
let weightsSeen: boolean[] = [false, false, false, false]
let biasSeen = false
let fanInSeen = false
function hslToHex(h: number, s: number, l: number) {
    h = h % 360
    s = s / 100
    l = l / 100
    c = (1 - Math.abs(2 * l - 1)) * s
    x = c * (1 - Math.abs(h / 60 % 2 - 1))
    m = l - c / 2
    let r, g, b;
    if (h < 60) {
        r = c
        g = x
        b = 0
    } else if (h < 120) {
        r = x
        g = c
        b = 0
    } else if (h < 180) {
        r = 0
        g = c
        b = x
    } else if (h < 240) {
        r = 0
        g = x
        b = c
    } else if (h < 300) {
        r = x
        g = 0
        b = c
    } else {
        r = c
        g = 0
        b = x
    }
    r = Math.round((r + m) * 255)
    g = Math.round((g + m) * 255)
    b = Math.round((b + m) * 255)
    return (r << 16) | (g << 8) | b
}

let m = 0
let x = 0
let c = 0
let l = 0
let s = 0
let h = 0

function rainbow () {
    for (let j = 0; j <= 330; j++) {
        basic.setLedColors(hslToHex(j % 360, 100, 30), hslToHex((j + 30) % 360, 100, 30), hslToHex((j + 60) % 360, 100, 30))
        basic.pause(4)
    }

    basic.turnRgbLedOff()
}
// ---- input (x) boards only ---------------------------------------------
// An x board has no weights. It holds a list of selectable values, each with a
// picture, and sends the selected one when a round starts.
let choiceValues: number[] = []
let choiceValuesSeen: boolean[] = []
// Pictures arrive from the sender as 25-character "0"/"1" strings, one per
// choice. Kept as text and drawn pixel by pixel -- see drawBits().
let choicePics: string[] = []

// How this x board scales its chosen value before putting it on the wire:
// sent = (chosen - myMean) / myStd. myStd of 0 means "send the raw value",
// which is what the sender transmits when the page has scaling switched off.
// Doing it here, rather than folding it into the first layer's weights, keeps
// the maths visible on the boards.
let myMean = 0
let myStd = 0

// ---- output (y) boards only --------------------------------------------
// The message shown when this neuron wins, its flash colour, and the level its
// output must exceed to count as a win. All three come from the sender.
let winMessage = ""
let winRed = 0
let winGreen = 0
let winBlue = 0
let outputThreshold = 0.5
// Set by the radio handlers, repainted by the main loop. Drawing must NEVER
// happen inside a handler: it blocks for hundreds of ms, and arriving radio
// packets and softSerial lines are lost outright while it does.
let displayDirty = false
let choiceCount = 0
let choiceIndex = 0

// ---- per-round input state ---------------------------------------------
// received[i] tracks whether inputs[i] has ARRIVED this round. A neuron can
// legitimately send 0.0, so the value itself can never mean "nothing yet".
let inputs: number[] = [0, 0, 0, 0]
let received: boolean[] = [false, false, false, false]
let armed = false         // true between a "calc" request and this neuron firing
let output = 0
// The last value this neuron produced, kept so button B can show it again after
// the screen has been cleared. hasOutput stays false until the first round, so
// an empty bar is never mistaken for a real 0.
let lastOutput = 0
let hasOutput = false

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
    rainbow()
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

// CAUTION: basic.showString / showNumber SCROLL and block long enough to lose
// an arriving softSerial line. Only showLeds / showIcon / clearScreen, which
// are instant, may be used in the hot paths.

// Draw a 25-character "0"/"1" bitmap, row by row. led.plot/unplot are instant;
// basic.showImage would block long enough to lose an arriving softSerial line.
function drawBits(bits: string) {
    for (let y = 0; y <= 4; y++) {
        for (let x = 0; x <= 4; x++) {
            if (bits.charAt(y * 5 + x) == "1") {
                led.plot(x, y)
            } else {
                led.unplot(x, y)
            }
        }
    }
}

// Put the screen back to whatever this board normally shows.
function showState() {
    if (isInputBoard()) {
        showChoice()
    } else if (ownName == "") {
        basic.showString("?")
    } else {
        basic.showString(ownName)
    }
}

function hasChoice(k: number): boolean {
    return k >= 0 && k < choiceValuesSeen.length && choiceValuesSeen[k]
}

// Show the board's state on the 5x5 matrix.
//
// Pictures come from the sender over radio (see sender.ts inputPictures), so a
// board stores no artwork of its own and the set can be changed without
// reflashing. drawBits is instant; nothing here scrolls.
function showChoice() {
    if (ownName == "") {
        basic.showString("?")              // no identity yet
        return
    }
    if (!hasChoice(choiceIndex)) {
        basic.showIcon(IconNames.No, 0)    // this choice never arrived
        return
    }
    if (choiceIndex < choicePics.length && choicePics[choiceIndex] != null) {
        drawBits(choicePics[choiceIndex])
        return
    }
    // Value known but its picture has not arrived yet: show the index as a
    // row of dots so the board is still usable.
    basic.clearScreen()
    for (let i = 0; i <= choiceIndex && i <= 4; i++) {
        led.plot(i, 2)
    }
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
    if (field == "m") {
        myMean = value
        return
    }
    if (field == "s") {
        myStd = value
        return
    }
    if (field == "n") {
        // x board: how many selectable choices. Starting a new list clears the
        // old one, so a re-push cannot leave stale values behind.
        choiceCount = value
        choiceIndex = 0
        choiceValues = []
        choiceValuesSeen = []
        choicePics = []
        return
    }
    if (field == "b") {
        bias = value
        biasSeen = true
        return
    }
    if (field == "t") {
        // y board: output must exceed this to count as a win
        outputThreshold = value
        return
    }
    if (field == "cr") {
        winRed = value
        return
    }
    if (field == "cg") {
        winGreen = value
        return
    }
    if (field == "cb") {
        winBlue = value
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

// ONE handler for every radio string -- there must only ever be one:
// registering radio.onReceivedString twice REPLACES the first, which silently
// killed identity assignment once already.
//
// Two shapes arrive here, both as TEXT because neither survives
// radio.sendValue()'s 32-bit float (exact only to 2^24):
//   "<serial>=<name>"         identity,  e.g. "-2022602061=x0"
//   "<name>p<k>:<25 chars>"   picture for choice k of an x board
radio.onReceivedString(function (receivedString) {
    // ---- picture: "<name>p<k>:<5 packed chars>" ----
    // The 25 pixels arrive PACKED, one character per row (5 bits each, code
    // 95 + value), because radio.sendString only carries 19 characters and the
    // unpacked form needed 30. See packPicture() in sender.ts.
    // Both the picture and the win message are "<head>:<payload>", so match on
    // the head rather than returning early -- an earlier version returned on
    // ANY colon message whose head was not a picture, which silently swallowed
    // the message chunks.
    let colon = receivedString.indexOf(":")
    let head = colon >= 0 ? receivedString.substr(0, colon) : ""
    let payload = colon >= 0
        ? receivedString.substr(colon + 1, receivedString.length - colon - 1)
        : ""
    let mine = head.length >= 3 && head.substr(0, 2) == ownName

    if (mine && head.charAt(2) == "p") {
        // Two shapes are accepted, so a board and a sender flashed at different
        // times cannot end up talking past each other:
        //   "<name>p<k>:<5 packed>"      a whole picture
        //   "<name>p<k>r<y>:<1 packed>"  a single row
        // Each packed character is 5 bits at code 95 + value.
        let rPos = head.indexOf("r")
        let k = 0
        let firstRow = 0
        let rows = 5
        if (rPos >= 3) {
            k = parseInt(head.substr(3, rPos - 3))
            firstRow = parseInt(head.substr(rPos + 1, head.length - rPos - 1))
            rows = 1
            if (firstRow < 0 || firstRow > 4) {
                return
            }
        } else {
            k = parseInt(head.substr(3, head.length - 3))
        }
        if (payload.length < rows) {
            return
        }
        while (choicePics.length <= k) {
            choicePics.push("0000000000000000000000000")
        }
        if (choicePics[k] == null) {
            choicePics[k] = "0000000000000000000000000"
        }
        for (let n = 0; n <= rows - 1; n++) {
            let y = firstRow + n
            let v = payload.charCodeAt(n) - 95
            let row = ""
            for (let x = 0; x <= 4; x++) {
                if (v & (1 << x)) {
                    row = row + "1"
                } else {
                    row = row + "0"
                }
            }
            choicePics[k] = choicePics[k].substr(0, y * 5) + row +
                choicePics[k].substr(y * 5 + 5, 25 - y * 5 - 5)
        }
        serial.writeLine("pic " + ownName + " " + k + " rows " + firstRow +
            "+" + rows + " <- [" + payload + "]")
        if (k == choiceIndex) {
            displayDirty = true
        }
        return
    }

    // ---- win message chunk: "<name>m<n>:<text>" ----
    // Chunked because radio.sendString carries only 19 characters. Chunk 0
    // starts a fresh message, later chunks append, so any length works.
    if (mine && head.charAt(2) == "m") {
        let n = parseInt(head.substr(3, head.length - 3))
        if (n == 0) {
            winMessage = payload
        } else {
            winMessage = winMessage + payload
        }
        return
    }

    // Any other colon message is not for us.
    if (colon >= 0) {
        return
    }

    // ---- identity: "<serial>=<name>" ----
    let eq = receivedString.indexOf("=")
    if (eq < 0) {
        return
    }
    let wantSerial = receivedString.substr(0, eq)
    let wantName = receivedString.substr(eq + 1, receivedString.length - eq - 1)
    let mySerial = convertToText(control.deviceSerialNumber())
    serial.writeLine("id? want [" + wantSerial + "](" + wantSerial.length +
        ") mine [" + mySerial + "](" + mySerial.length + ") -> " +
        (wantSerial == mySerial ? "MATCH " + wantName : "no"))
    if (wantSerial == mySerial) {
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
softSerial.onLine(DigitalPin.P1, softSerial.BaudRate.Baud1200, function (line) {
    basic.pause(10)
    serial.writeLine("RX P1 raw: [" + line + "]")
    inputs[1] = parseFloat(line)
    received[1] = true
})
softSerial.onLine(DigitalPin.P2, softSerial.BaudRate.Baud1200, function (line) {
    basic.pause(10)
    serial.writeLine("RX P2 raw: [" + line + "]")
    inputs[2] = parseFloat(line)
    received[2] = true
})
softSerial.onLine(DigitalPin.P0, softSerial.BaudRate.Baud1200, function (line) {
    basic.pause(10)
    serial.writeLine("RX P0 raw: [" + line + "]")
    inputs[0] = parseFloat(line)
    received[0] = true
})

// ============================================================
//  Main loop: fire once per round, when every input has arrived
// ============================================================
basic.forever(function () {
    basic.pause(20)
    // Repaint here rather than in the radio handlers that set displayDirty.
    // basic.showString scrolls for over a second, and a board stuck in it MISSES
    // an arriving softSerial line outright -- bit-banged serial has no buffer.
    // Doing it here keeps handlers instant, and a repaint only ever happens on a
    // state change, never mid-round.
    if (displayDirty) {
        displayDirty = false
        showState()
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
        // Scale before sending, when the sender has given this board a mean and
        // spread. The network was trained on scaled values, so the scaling has
        // to happen somewhere; doing it here keeps it visible on the board
        // instead of hidden inside the first layer's weights.
        output = choiceValues[choiceIndex]
        if (myStd != 0) {
            output = (output - myMean) / myStd
            serial.writeLine("chose " + choiceValues[choiceIndex] + " -> scaled " + output)
        }
        serial.writeLine("TX P3: " + output + " (from " + ownName + ")")
        basic.showIcon(IconNames.ArrowEast)
        softSerial.writeLine(DigitalPin.P3, softSerial.BaudRate.Baud1200, convertToText(output))
        basic.pause(1000)
        showChoice()
        armed = false
        return
    }
    if (!hasAllInputs()) {
        return
    }
    output = getNeuronOutput()
    lastOutput = output
    hasOutput = true
    serial.writeValue("out_" + ownName, output)
    // A bar, not a scrolling number: instant instead of ~a second of blocking,
    // and the height reads at a glance. The 1 is the top of the scale -- with 0
    // MakeCode auto-scales to the largest value it has seen, which would make
    // the bar mean something different from one round to the next.
    led.plotBarGraph(output, 1)
    // writeLine, NOT writeNumber: softSerial.onLine fires on a NEWLINE, and
    // writeNumber does not append one, so the receiver's handler never runs.
    // This is what the working nn.ts does and it is why nothing was received.
    softSerial.writeLine(DigitalPin.P3, softSerial.BaudRate.Baud1200, convertToText(output))
    basic.pause(500)
    basic.clearScreen()
    // Output neurons also report back, so the sender can pick the winner.
    if (ownName.charAt(0) == "y") {
        radio.sendValue(ownName + "o", output)
        // Announce a win locally, the way nn.ts did: flash this neuron's own
        // colour, then scroll its message. Colour, message and threshold all
        // come from the sender, so they change without reflashing.
        // Blocking is safe here: the round is over and no input is expected
        // until the next "calc".
        if (output > outputThreshold) {
            for (let index = 0; index < 5; index++) {
                basic.setLedColor(basic.rgb(winRed, winGreen, winBlue))
                basic.pause(100)
                basic.turnRgbLedOff()
                basic.pause(100)
            }
            if (winMessage != "") {
                basic.showString(winMessage)
            }
            displayDirty = true      // go back to showing the board's name
        }
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
    softSerial.writeLine(DigitalPin.P3, softSerial.BaudRate.Baud1200, convertToText(0.5))
    basic.pause(200)
})

// A+B: start a round for the WHOLE network from any board, exactly as the
// sender's B button does. The x boards then send their values, those reach the
// hidden layer over the cables, and the wave runs through to the answers -- so
// a round can be triggered without the sender being plugged in.
//
// This board arms itself too: "calc" is a broadcast, and a board does not hear
// its own radio messages.
input.onButtonEvent(Button.AB, input.buttonEventClick(), function () {
    serial.writeLine((ownName == "" ? "?" : ownName) + ": calc for everyone")
    radio.sendValue("calc", 0)
    armed = true
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
    // Paste this line into the board table on the web page (or allSerials[] in
    // sender.ts), quotes and all.
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
    // Show the last result again as a bar -- after a round the screen has been
    // cleared, so this is the only way to see what this neuron decided.
    if (hasOutput) {
        serial.writeValue("last_" + ownName, lastOutput)
        led.plotBarGraph(lastOutput, 1)
    } else {
        serial.writeLine(ownName + ": has not calculated anything yet")
        showState()
    }
})

// Show that we are up but not yet claimed.
basic.showString("?")
