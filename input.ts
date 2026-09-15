input.onButtonEvent(Button.A, input.buttonEventClick(), function () {
    if (outputindex > 1) {
        outputindex = outputindex + -1
        showPic()
    }
})
let alloutputs =
    [[0.25, 0.5, 0.75, 1.0],
    [0.2, 0.4, 0.6, 0.8, 1.0]]

let allweights = 
    [[8.468311946492, -15.777259975468265, 1.6240190707936146],
    [10.151287262326619, -11.387501878042364, -0.12801763005923056],
    [-9.865710916162397, -1.7296569850093202, 11.775940812933898],
    [-4.758934173183672, -9.282315308018319, 9.533732130267774, 9.517074238087051],
    [4.758934173183669, 10.367666462491574, -8.88285326050701, -9.6635054619619]]


input.onButtonEvent(Button.AB, input.buttonEventClick(), function () {
    

    let names = ["h0", "h1", "h2", "y0", "y1"]
    basic.showString("sende",70)

    for (let i = 0; i < allweights.length; i++) {
        let row = allweights[i]
        let n = names[i]
        // row[0] is the bias, the rest are the weights
        radio.sendValue(n + "b", row[0])
        basic.pause(100)
        for (let j = 1; j < row.length; j++) {
            radio.sendValue(n + "w" + (j - 1), row[j])
            basic.pause(100)
        }
    }
    basic.showString("fertig",70)
    showPic()
})
input.onButtonEvent(Button.B, input.buttonEventClick(), function () {
    if (outputindex < 4 && ownName == "x0" || outputindex < 5 && ownName == "x1") {
        outputindex = outputindex + 1
        showPic()
    }
})
radio.onReceivedString(function (receivedString) {
    serial.writeLine("recv: " + receivedString)
    if (receivedString.includes("calc")) {
        if (ownName.includes("x")) {
            basic.showIcon(IconNames.ArrowEast, 1500)
            if(ownName=='x0')
                {
                    softSerial.writeLine(DigitalPin.P3, softSerial.BaudRate.Baud1200, convertToText(alloutputs[0][outputindex-1]))
                }

            if(ownName=='x1')
                {
                    softSerial.writeLine(DigitalPin.P3, softSerial.BaudRate.Baud1200, convertToText(alloutputs[1][outputindex-1]))
                }
            showPic()
        }
    }
})
function showPic () {
    if (ownName == "x0") {
        if (outputindex == 1) {
            basic.showLeds(`
                # # . # #
                # # . # #
                . . . . .
                . . . . .
                . . . . .
                `)
        }
        if (outputindex == 2) {
            basic.showLeds(`
                . . . # #
                # # . # #
                . . . . .
                . . . . .
                . . . . .
                `)
        }
        if (outputindex == 3) {
            basic.showLeds(`
                # . . # .
                . # . . #
                . . . . .
                . . . . .
                . . . . .
                `)
        }
        if (outputindex == 4) {
            basic.showLeds(`
                . . . . .
                # # . # #
                . . . . .
                . . . . .
                . . . . .
                `)
        }
    }
    if (ownName == "x1") {
        if (outputindex == 1) {
            basic.showLeds(`
                . . . . .
                . . . . .
                . # # # .
                # . . . #
                # # # # #
                `)
        }
        if (outputindex == 2) {
            basic.showLeds(`
                . . . . .
                . . . . .
                . . . . .
                # . . . #
                . # # # .
                `)
        }
        if (outputindex == 3) {
            basic.showLeds(`
                . . . . .
                . . . . .
                # # # # .
                # . . # .
                . # # . #
                `)
        }
        if (outputindex == 4) {
            basic.showLeds(`
                . . . . .
                . . . . .
                # # # # #
                # # # # #
                . # # # .
                `)
        }
        if (outputindex == 5) {
            basic.showLeds(`
                . . . . .
                . . . . .
                # # # # #
                # . . . #
                . # # # .
                `)
        }
    }
}
let ownName = ""
let outputindex = 0
outputindex = 1
ownName = "x1"
serial.writeLine("inputlayer")
showPic()

