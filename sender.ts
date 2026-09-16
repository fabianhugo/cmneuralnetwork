// ============================================================
//  SENDER  --  flash this onto ONE board. It is not a neuron.
//
//  It holds:
//    * the table of micro:bit serial number -> neuron name, for the five
//      neurons AND the two x input boards,
//    * every weight and bias exported from the training page,
//    * each x board's selectable values and their pictures,
//  and pushes them all over radio. neuron.ts is identical on all seven
//  boards; this file is what tells each one who it is and what to do.
//
//  Buttons:
//    A   push identity + all parameters to every neuron
//    B   request one calculation round ("calc")
//    A+B print the whole table to serial
//
//  It is also a UART -> RADIO BRIDGE. Connect this board to a browser over
//  WebUSB (kids.html) and the page can load a freshly trained network into the
//  neurons without anyone editing this file. See section 6.
// ============================================================

radio.setGroup(1)

// ============================================================
//  1. WHICH BOARD IS WHICH NEURON
//
//  Read each board's serial number off the USB serial log (neuron.ts prints
//  it on button B) and paste it in here. The name decides what the board
//  does; the order of this list does not matter.
//
//  Kept as STRINGS on purpose: radio.sendValue() carries a 32-bit FLOAT, exact
//  only for integers up to 2^24 (16777216). Every serial below is far larger,
//  so sending one as a number rounds it (139422584 -> 139422592) and it could
//  never match. Identity therefore travels as text via radio.sendString().
// ============================================================
//  NOTE: the serial is a SIGNED 32-bit int and can be NEGATIVE -- h0 reports
//  -1394225184. Keep the minus sign and every digit exactly as the board prints
//  it. Press B on a board and it prints a ready-to-paste quoted line.
// ONE table for every board -- inputs, hidden neurons and answers alike. The
// two entries line up by position: serialOf("h1") is the serial whose
// allNames[i] is "h1". Looking a serial up BY NAME means nothing depends on a
// second table staying in the same order as this one.
let allNames: string[] = [
    "x0",
    "x1",
    "h0",
    "h1",
    "h2",
    "y0",
    "y1"
]
let allSerials: string[] = [
    "-2022602061",   // -> x0
    "984150378",     // -> x1
    "-1394225184",   // -> h0   confirmed from the board's own dump
    "-1280350870",   // -> h1   <-- UNCONFIRMED, re-read with button B
    "850974008",     // -> h2   <-- UNCONFIRMED, re-read with button B
    "1240653277",    // -> y0   <-- UNCONFIRMED, re-read with button B
    "1843421070"     // -> y1   <-- UNCONFIRMED, re-read with button B
]

// The serial for a board name, or "0" when the page has not set one yet.
function serialOf(name: string): string {
    for (let i = 0; i <= allNames.length - 1; i++) {
        if (allNames[i] == name) {
            return allSerials[i]
        }
    }
    return "0"
}

// Remember which physical board plays `name`, adding it if it is new.
function setSerial(name: string, sn: string) {
    for (let i = 0; i <= allNames.length - 1; i++) {
        if (allNames[i] == name) {
            allSerials[i] = sn
            return
        }
    }
    allNames.push(name)
    allSerials.push(sn)
}

// The neuron boards, in the order their weights arrive: hidden layers first,
// then the answers. Rebuilt by the ARCH command.
let boardNames: string[] = [
    "h0",
    "h1",
    "h2",
    "y0",
    "y1"
]

// ============================================================
//  2. THE NETWORK  --  2-3-2, sigmoid, trained with input scaling OFF
//
//  Straight from the training page's CSV export. One entry per neuron, in
//  order h0, h1, h2, y0, y1; each is [bias, w0, w1, ...] where wJ is the
//  weight on the J-th incoming connection.
//
//  Wire it so those J's line up with the pins:
//      h0/h1/h2 :  P0 = x0,  P1 = x1          (from the two x boards)
//      y0/y1    :  P0 = h0,  P1 = h1,  P2 = h2
// ============================================================
let netBias: number[] = [
    8.468311946492,           // h0
    10.151287262326619,       // h1
    -9.865710916162397,       // h2
    -4.758934173183672,       // y0
    4.758934173183669         // y1
]
let netWeights: number[][] = [
    [-15.777259975468265, 1.6240190707936146],                      // h0 <- x0, x1
    [-11.387501878042364, -0.12801763005923056],                    // h1 <- x0, x1
    [-1.7296569850093202, 11.775940812933898],                      // h2 <- x0, x1
    [-9.282315308018319, 9.533732130267774, 9.517074238087051],     // y0 <- h0, h1, h2
    [10.367666462491574, -8.88285326050701, -9.6635054619619]       // y1 <- h0, h1, h2
]

// ============================================================
//  2a. THE OUTPUT LAYER  --  what each y board announces when it wins
//
//  When an output neuron's value exceeds outputThreshold it flashes its colour
//  and scrolls its message, the way nn.ts did ("frech" / "nicht frech").
//  Edit the text here and it is pushed over radio -- no reflashing.
// ============================================================
let outputNames: string[] = ["y0", "y1"]

// One message per output neuron, in the same order.
let outputMessages: string[] = [
    "nicht frech",     // y0 wins
    "frech"            // y1 wins
]

// Flash colour per output neuron, as [red, green, blue], 0-255.
let outputColors: number[][] = [
    [0, 40, 0],        // y0: green
    [40, 0, 0]         // y1: red
]

// A neuron announces itself only if its output exceeds this.
let outputThreshold = 0.5

// ============================================================
//  2c. INPUT SCALING
//
//  When the training page standardizes its inputs, the network only works on
//  standardized values. Rather than hide that inside the weights, each x board
//  is told its own mean and spread and does the scaling itself, right before it
//  puts the value on the wire: sent = (chosen - mean) / std.
//  normOn = false means the boards send the raw value.
// ============================================================
let normOn = false
let normMean: number[] = []
let normStd: number[] = []

// ============================================================
//  2b. THE INPUT LAYER  --  what each x board offers to choose from
//
//  Each x board gets a list of selectable values and one picture per value.
//  On the board, A and B step through the list and the picture is displayed;
//  the selected value is sent into the network when a round starts.
//
//  Pictures are 5 rows of 5 characters, "1" = lit, "0" = dark. Edit them here
//  and they are pushed to the boards -- the boards store no pictures of their
//  own. Keep each row exactly 5 characters long.
// ============================================================
let inputNames: string[] = ["x0", "x1"]

// One row per x board: the values that board can send.
let inputChoices: number[][] = [
    [0.25, 0.50, 0.75, 1.00],        // x0
    [0.2, 0.4, 0.6, 0.8, 1.0]        // x1
]

// One picture per choice, in the same order as inputChoices. 5 rows of 5
// characters, "1" = lit. Copied verbatim from the working input.ts, so the
// boards show exactly the artwork they did before -- but sent over radio, so
// changing a picture here needs no reflashing of the neuron boards.
let inputPictures: string[][] = [
    [
        "11011" + "11011" + "00000" + "00000" + "00000",   // x0 = 0.25
        "00011" + "11011" + "00000" + "00000" + "00000",   // x0 = 0.50
        "10010" + "01001" + "00000" + "00000" + "00000",   // x0 = 0.75
        "00000" + "11011" + "00000" + "00000" + "00000"    // x0 = 1.00
    ],
    [
        "00000" + "00000" + "01110" + "10001" + "11111",   // x1 = 0.2
        "00000" + "00000" + "00000" + "10001" + "01110",   // x1 = 0.4
        "00000" + "00000" + "11110" + "10010" + "01101",   // x1 = 0.6
        "00000" + "00000" + "11111" + "11111" + "01110",   // x1 = 0.8
        "00000" + "00000" + "11111" + "10001" + "01110"    // x1 = 1.0
    ]
]

// ============================================================
//  3. Pushing the parameters out
// ============================================================
// Radio messages are small and unacknowledged, so pace them and send the
// identity first -- a neuron ignores weights until it knows its own name.
// Tell a board who it is. Repeated because radio is unacknowledged and this is
// the one message a board cannot do without: miss it and the board ignores
// everything else that follows, staying on "?" for the whole round.
function sendIdentity(name: string) {
    let sn = serialOf(name)
    let msg = sn + "=" + name
    // Print exactly what goes on the air, so it can be compared with the
    // "id? want [...] mine [...]" line each board logs. A board staying "?"
    // is either not hearing this, or hearing a serial that is not its own.
    serial.writeLine("id-> [" + msg + "]" +
        (sn == "0" ? "   <-- NO SERIAL SET for " + name : ""))
    for (let attempt = 0; attempt <= 2; attempt++) {
        radio.sendString(msg)
        basic.pause(120)
    }
}

function sendNeuron(index: number) {
    let name = boardNames[index]
    let weights = netWeights[index]

    // Identity first: only the board whose serial number matches takes this
    // name. Everything after it is addressed to the name, so this MUST land --
    // and radio is unacknowledged, so a single send loses the board for the
    // whole round. Sent three times; a repeat is harmless because a board that
    // already has the name simply re-adopts it.
    sendIdentity(name)
    radio.sendValue(name + "i", weights.length)   // fanIn
    basic.pause(60)
    radio.sendValue(name + "b", netBias[index])   // bias
    basic.pause(60)
    for (let j = 0; j <= weights.length - 1; j++) {
        radio.sendValue(name + "w" + j, weights[j])
        basic.pause(60)
    }
    serial.writeLine("sent " + name + " (" + weights.length + " weights)")
}

// Pack a 25-character "0"/"1" picture into 5 characters, one per row: each row
// is 5 bits (0..31), sent as the character at code 95 + value.
//
// Why: radio.sendString carries at most 19 characters, and
// "<name>p<k>:<25 bits>" is 30 -- it arrived truncated and was silently
// rejected, so the boards only ever showed the fallback dots. Packed, the whole
// message is 10 characters.
//
// Why base 95: codes 95..126 ("_" through "~") are 32 consecutive printable
// characters containing no ":" (the field separator), no quote and no
// backslash, so nothing needs escaping and nothing confuses the parser.
// Pack a MakeCode Image directly, so pictures can be authored in the editor's
// visual grid instead of as "0"/"1" text:
//
//     sendPicture("x0", 0, images.createImage(`
//         . . . . .
//         . # . . #
//         . # . . #
//         . . # # #
//         . . . . .
//         `))
//
// Same wire format as packPicture -- 5 bits per character, one per row.
function packImage(img: Image): string {
    let out = ""
    for (let y = 0; y <= 4; y++) {
        let v = 0
        for (let x = 0; x <= 4; x++) {
            if (img.pixel(x, y)) {
                v = v | (1 << x)
            }
        }
        out = out + String.fromCharCode(95 + v)
    }
    return out
}

// Send one MakeCode Image as choice k's picture for board `name` ("x0"/"x1").
// Fits a single radio message (10 characters).
function sendPicture(name: string, k: number, img: Image) {
    radio.sendString(name + "p" + k + ":" + packImage(img))
}

function packPicture(bits: string): string {
    let out = ""
    for (let y = 0; y <= 4; y++) {
        let v = 0
        for (let x = 0; x <= 4; x++) {
            if (bits.charAt(y * 5 + x) == "1") {
                v = v | (1 << x)
            }
        }
        out = out + String.fromCharCode(95 + v)
    }
    return out
}

// Give a y board its win message, flash colour and threshold. The message is
// sent in chunks because radio.sendString carries only 19 characters; chunk 0
// replaces whatever was there, later chunks append.
function sendOutput(index: number) {
    let name = outputNames[index]
    let msg = outputMessages[index]
    let col = outputColors[index]

    radio.sendValue(name + "t", outputThreshold)
    basic.pause(120)
    radio.sendValue(name + "cr", col[0])
    basic.pause(120)
    radio.sendValue(name + "cg", col[1])
    basic.pause(120)
    radio.sendValue(name + "cb", col[2])
    basic.pause(120)

    // "<name>m<n>:" is 5 characters while the chunk index is one digit, leaving
    // 14 of the 19-character radio limit. At chunk 10 the header grows to 6, so
    // 13 is used throughout -- a message past 130 characters would otherwise
    // emit a 20-character message that the radio silently truncates.
    let chunk = 0
    let pos = 0
    while (pos < msg.length) {
        let take = chunk < 10 ? 14 : 13
        radio.sendString(name + "m" + chunk + ":" + msg.substr(pos, take))
        basic.pause(150)
        pos = pos + take
        chunk = chunk + 1
    }
    serial.writeLine("sent " + name + " message: " + msg)
}

// Give an x board its identity, its list of values and one picture per value.
function sendInput(index: number) {
    let name = inputNames[index]
    let values = inputChoices[index]
    let pics = inputPictures[index]

    sendIdentity(name)
    radio.sendValue(name + "n", values.length)        // how many choices
    basic.pause(200)

    // How this board scales its value before sending it on. "s" of 0 means
    // "no scaling"; anything else is the divisor, with "m" the mean.
    if (normOn && index <= normMean.length - 1) {
        radio.sendValue(name + "m", normMean[index])
        basic.pause(150)
        radio.sendValue(name + "s", normStd[index])
        basic.pause(150)
    } else {
        radio.sendValue(name + "s", 0)
        basic.pause(150)
    }

    // VALUES FIRST, all of them, before any picture. The values are what the
    // board needs to work at all; the big picture strings are decoration.
    // Interleaving them meant a picture was in flight while the next value was
    // sent, and the value lost the race.
    for (let k = 0; k <= values.length - 1; k++) {
        radio.sendValue(name + "v" + k, values[k])
        basic.pause(200)
    }
    // Send them once more: radio is unacknowledged, and a dropped value leaves
    // a hole the board cannot fill on its own. A repeat just overwrites its
    // own slot, so it is harmless.
    for (let k = 0; k <= values.length - 1; k++) {
        radio.sendValue(name + "v" + k, values[k])
        basic.pause(200)
    }
    // Pictures last, once the board is already usable. One message each: the
    // 25 bits are PACKED, five per character, so the whole picture fits in the
    // 19-character limit radio.sendString imposes (see packPicture).
    for (let k = 0; k <= pics.length - 1; k++) {
        radio.sendString(name + "p" + k + ":" + packPicture(pics[k]))
        basic.pause(150)
    }
    serial.writeLine("sent " + name + " (" + values.length + " choices)")
}

// Catch a mis-edited table before it goes on the air: a missing picture or a
// wrong-length row would otherwise just silently fail to show on the board.
function checkInputTables() {
    for (let i = 0; i <= inputNames.length - 1; i++) {
        if (inputChoices[i].length != inputPictures[i].length) {
            serial.writeLine("WARNING " + inputNames[i] + ": " +
                inputChoices[i].length + " values but " +
                inputPictures[i].length + " pictures")
        }
        for (let k = 0; k <= inputPictures[i].length - 1; k++) {
            if (inputPictures[i][k].length != 25) {
                serial.writeLine("WARNING " + inputNames[i] + " picture " + k +
                    ": " + inputPictures[i][k].length + " chars, need 25")
            }
        }
        if (serialOf(inputNames[i]) == "0") {
            serial.writeLine("WARNING " + inputNames[i] + ": serial not set")
        }
    }
}

function sendAll() {
    basic.showString("S")
    checkInputTables()
    for (let i = 0; i <= boardNames.length - 1; i++) {
        sendNeuron(i)
    }
    for (let i = 0; i <= inputNames.length - 1; i++) {
        sendInput(i)
    }
    for (let i = 0; i <= outputNames.length - 1; i++) {
        sendOutput(i)
    }
    basic.showIcon(IconNames.Yes)
    basic.pause(400)
    basic.clearScreen()
}

// ============================================================
//  4. Collecting the answer
// ============================================================
let yOut: number[] = [0, 0]
let ySeen: boolean[] = [false, false]

radio.onReceivedValue(function (name, value) {
    // Output neurons report "y0o" / "y1o" when they finish a round.
    if (name == "y0o") {
        yOut[0] = value
        ySeen[0] = true
    }
    if (name == "y1o") {
        yOut[1] = value
        ySeen[1] = true
    }
    if (ySeen[0] && ySeen[1]) {
        // Both logits in: the bigger one wins. Sigmoid is monotonic, so this
        // is the same class the training page's softmax would pick.
        let winner = yOut[0] >= yOut[1] ? 0 : 1
        serial.writeLine("y0=" + yOut[0] + "  y1=" + yOut[1] + "  -> class " + winner)
        basic.showNumber(winner)
        ySeen[0] = false
        ySeen[1] = false
    }
})

// ============================================================
//  6. UART -> RADIO BRIDGE
//
//  The browser (kids.html) opens this board over WebUSB and writes plain text
//  lines. Each line is one command; the board answers with a line so the page
//  can wait for it rather than guessing at timing.
//
//    PING                    -> "OK PING"        is anyone there?
//    ARCH <n0,n1,...>        -> "OK ARCH ..."    layer sizes, e.g. "2,3,2"
//    SERIAL <name> <sn>      -> "OK SERIAL <name>"  which physical board plays
//                                                this neuron, by name,
//                                                e.g. "SERIAL h0 -1394225184"
//    NEURON <i> <b> <w,w,..> -> "OK NEURON <i>"  one neuron's bias + weights
//    MSG <i> <text>          -> "OK MSG <i>"     win message for output i
//    COL <i> <r> <g> <b>     -> "OK COL <i>"     win colour for output i
//    THRESH <v>              -> "OK THRESH"      win threshold
//    NORM <i> <mean> <std>   -> "OK NORM <i>"    how x board i scales its value
//    NORM off                -> "OK NORM off"   send raw values instead
//    CHOICES <i> <v,v,...>   -> "OK CHOICES <i>" an x board's values
//    PIC <i> <k> <25 bits>   -> "OK PIC <i> <k>" one picture, as 0/1 text
//    SEND                    -> "OK SEND"        push everything over radio
//    CALC                    -> "OK CALC"        run one round
//
//  Names are assigned positionally: neuron i takes boardNames[i], so the
//  serial-number table above still decides which physical board is which.
//  A line that does not parse answers "ERR <reason>" and changes nothing.
// ============================================================

// Split "a,b,c" into numbers. Returns an empty array for an empty string.
function parseNumbers(csv: string): number[] {
    let out: number[] = []
    let cur = ""
    for (let i = 0; i <= csv.length - 1; i++) {
        let ch = csv.charAt(i)
        if (ch == ",") {
            if (cur.length > 0) {
                out.push(parseFloat(cur))
            }
            cur = ""
        } else if (ch != " ") {
            cur = cur + ch
        }
    }
    if (cur.length > 0) {
        out.push(parseFloat(cur))
    }
    return out
}

// Split a line on spaces into at most `max` fields. Once max-1 fields are out,
// the rest of the line becomes the final field verbatim -- so a win message may
// contain spaces ("MSG 1 sehr frech heute" keeps all three words).
function splitFields(line: string, max: number): string[] {
    let out: string[] = []
    let cur = ""
    let i = 0
    while (i <= line.length - 1) {
        let ch = line.charAt(i)
        if (ch == " " && out.length < max - 1) {
            if (cur.length > 0) {
                out.push(cur)
                cur = ""
            }
            // Skip any run of spaces.
            while (i + 1 <= line.length - 1 && line.charAt(i + 1) == " ") {
                i = i + 1
            }
        } else {
            cur = cur + ch
        }
        i = i + 1
    }
    if (cur.length > 0) {
        out.push(cur)
    }
    return out
}

// Grow an array of arrays so index i exists.
function ensureRow(arr: number[][], i: number) {
    while (arr.length <= i) {
        arr.push([])
    }
}

function handleLine(line: string) {
    // Strip a trailing CR: browsers commonly send "\r\n".
    let s = line
    while (s.length > 0 && (s.charAt(s.length - 1) == "\r" || s.charAt(s.length - 1) == "\n")) {
        s = s.substr(0, s.length - 1)
    }
    if (s.length == 0) {
        return
    }
    // How many fields to split into depends on the command: MSG's text is the
    // rest of the line and must not be split at its spaces, whereas COL needs
    // five separate numbers. Splitting everything at 5 truncated messages to
    // their first word.
    let cmd = splitFields(s, 2)[0]
    let f = splitFields(s, cmd == "MSG" ? 3 : 5)

    if (cmd == "PING") {
        serial.writeLine("OK PING")
        return
    }

    if (cmd == "ARCH") {
        if (f.length < 2) {
            serial.writeLine("ERR ARCH needs sizes")
            return
        }
        let sizes = parseNumbers(f[1])
        if (sizes.length < 2) {
            serial.writeLine("ERR ARCH needs at least 2 layers")
            return
        }
        // The neuron boards are named h0.. then y0.., so rebuild both name
        // tables from the architecture. The serial table keeps its order, so
        // board i keeps the physical board it always had.
        // Hidden neurons are numbered ACROSS all hidden layers (h0, h1, h2, ...),
        // not restarted per layer -- two layers both starting at h0 would give
        // two boards the same name and they would fight over every message.
        let names: string[] = []
        let hn = 0
        for (let l = 1; l <= sizes.length - 2; l++) {
            for (let i = 0; i <= sizes[l] - 1; i++) {
                names.push("h" + hn)
                hn = hn + 1
            }
        }
        let outs: string[] = []
        for (let i = 0; i <= sizes[sizes.length - 1] - 1; i++) {
            outs.push("y" + i)
            names.push("y" + i)
        }
        boardNames = names
        outputNames = outs
        serial.writeLine("OK ARCH " + names.length + " neurons")
        return
    }

    if (cmd == "SERIAL") {
        // Tell the bridge which physical board plays a given neuron, so the
        // page owns the mapping and nobody has to edit the table above.
        // Addressed by NAME ("x0", "h2", "y1"), which needs no role flag and
        // cannot be desynchronised from a second table.
        if (f.length < 3) {
            serial.writeLine("ERR SERIAL needs name serial")
            return
        }
        setSerial(f[1], f[2])
        serial.writeLine("OK SERIAL " + f[1])
        return
    }

    if (cmd == "NEURON") {
        if (f.length < 4) {
            serial.writeLine("ERR NEURON needs index bias weights")
            return
        }
        let i = parseInt(f[1])
        if (i < 0 || i > 40) {
            serial.writeLine("ERR NEURON bad index")
            return
        }
        while (netBias.length <= i) {
            netBias.push(0)
        }
        ensureRow(netWeights, i)
        netBias[i] = parseFloat(f[2])
        netWeights[i] = parseNumbers(f[3])
        serial.writeLine("OK NEURON " + i)
        return
    }

    if (cmd == "MSG") {
        if (f.length < 3) {
            serial.writeLine("ERR MSG needs index text")
            return
        }
        let i = parseInt(f[1])
        while (outputMessages.length <= i) {
            outputMessages.push("")
        }
        outputMessages[i] = f[2]
        serial.writeLine("OK MSG " + i)
        return
    }

    if (cmd == "COL") {
        if (f.length < 5) {
            serial.writeLine("ERR COL needs index r g b")
            return
        }
        let i = parseInt(f[1])
        ensureRow(outputColors, i)
        outputColors[i] = [parseFloat(f[2]), parseFloat(f[3]), parseFloat(f[4])]
        serial.writeLine("OK COL " + i)
        return
    }

    if (cmd == "THRESH") {
        if (f.length < 2) {
            serial.writeLine("ERR THRESH needs a value")
            return
        }
        outputThreshold = parseFloat(f[1])
        serial.writeLine("OK THRESH")
        return
    }

    if (cmd == "NORM") {
        if (f.length < 2) {
            serial.writeLine("ERR NORM needs index mean std, or off")
            return
        }
        if (f[1] == "off") {
            normOn = false
            serial.writeLine("OK NORM off")
            return
        }
        if (f.length < 4) {
            serial.writeLine("ERR NORM needs index mean std")
            return
        }
        let ni = parseInt(f[1])
        while (normMean.length <= ni) {
            normMean.push(0)
            normStd.push(1)
        }
        normMean[ni] = parseFloat(f[2])
        let sd = parseFloat(f[3])
        normStd[ni] = sd == 0 ? 1 : sd
        normOn = true
        serial.writeLine("OK NORM " + ni)
        return
    }

    if (cmd == "CHOICES") {
        if (f.length < 3) {
            serial.writeLine("ERR CHOICES needs index values")
            return
        }
        let i = parseInt(f[1])
        ensureRow(inputChoices, i)
        inputChoices[i] = parseNumbers(f[2])
        serial.writeLine("OK CHOICES " + i)
        return
    }

    if (cmd == "PIC") {
        if (f.length < 4) {
            serial.writeLine("ERR PIC needs board choice bits")
            return
        }
        let bi = parseInt(f[1])
        let k = parseInt(f[2])
        let bits = f[3]
        if (bits.length != 25) {
            serial.writeLine("ERR PIC needs 25 bits, got " + bits.length)
            return
        }
        while (inputPictures.length <= bi) {
            inputPictures.push([])
        }
        while (inputPictures[bi].length <= k) {
            inputPictures[bi].push("0000000000000000000000000")
        }
        inputPictures[bi][k] = bits
        serial.writeLine("OK PIC " + bi + " " + k)
        return
    }

    if (cmd == "SEND") {
        sendAll()
        serial.writeLine("OK SEND")
        return
    }

    if (cmd == "CALC") {
        ySeen[0] = false
        ySeen[1] = false
        radio.sendValue("calc", 0)
        serial.writeLine("OK CALC")
        return
    }

    serial.writeLine("ERR unknown command " + cmd)
}

serial.onDataReceived(serial.delimiters(Delimiters.NewLine), function () {
    handleLine(serial.readLine())
})

// ============================================================
//  5. Buttons
// ============================================================
input.onButtonEvent(Button.A, input.buttonEventClick(), function () {
    sendAll()
})

input.onButtonEvent(Button.B, input.buttonEventClick(), function () {
    ySeen[0] = false
    ySeen[1] = false
    serial.writeLine("--- calc ---")
    radio.sendValue("calc", 0)
})

input.onButtonEvent(Button.AB, input.buttonEventClick(), function () {
    serial.writeLine("=== board table ===")
    for (let i = 0; i <= allNames.length - 1; i++) {
        let nm = allNames[i]
        let line = nm + "  serial " + allSerials[i]
        // Add whatever else is known about this board.
        for (let k = 0; k <= inputNames.length - 1; k++) {
            if (inputNames[k] == nm) {
                line = line + "  choices " + inputChoices[k].length +
                       "  pictures " + inputPictures[k].length
            }
        }
        for (let k = 0; k <= boardNames.length - 1; k++) {
            if (boardNames[k] == nm && k <= netWeights.length - 1) {
                line = line + "  fanIn " + netWeights[k].length +
                       "  bias " + netBias[k]
            }
        }
        if (allSerials[i] == "0") {
            line = line + "   <-- SERIAL NOT SET"
        }
        serial.writeLine(line)
        // Without this the USB serial link drops characters mid-line.
        basic.pause(50)
    }
})

serial.writeLine("sender ready -- A = send parameters, B = calculate")
basic.showString("TX")
