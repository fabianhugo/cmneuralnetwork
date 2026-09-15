function hslToHex (h: number, s: number, l: number) {
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
function rainbow () {
    let brightness;
for (let j = 0; j <= 299; j++) {
        basic.setLedColors(hslToHex(j % 360, 100, 30), hslToHex((j + 30) % 360, 100, 30), hslToHex((j + 60) % 360, 100, 30))
        basic.pause(7)
    }
    // Faden
    for (let p = 0; p <= 30; p++) {
        brightness = Math.max(0, 8 - p * 0.26)
        basic.setLedColors(hslToHex(299 % 360, 100, 30 - p), hslToHex((299 + 30) % 360, 100, 30 - p), hslToHex((299 + 60) % 360, 100, 30 - p))
        basic.pause(7)
    }
    basic.turnRgbLedOff()
}
function sigmoid (num: number) {
    return 1 / (1 + Math.E ** (0 - num))
}
radio.onReceivedValue(function (name, value) {
    if (name == control.deviceName()) {
        radio.sendValue(control.deviceName(), 1)
        listen = 1
        time = input.runningTime()
    }
    if (listen) {
        if (value == 99999) {
            ownName = name
        }
        for (let index = 0; index <= maxWeights; index++) {
            if (name.substr(0, 2) == "w" + index) {
                ownWeights[index] = value
            }
        }
        if (name.substr(0, 1) == "b") {
            ownBias = value
        }
        if (input.runningTime() - time < timeout) {
            listen = 0
            basic.showString("updated")
        }
    }
})
function getNeuronOutput () {
    let inputs: number[] = []
    if (ownName.includes("h")) {
        for (let index322 = 0; index322 <= ownWeights.length; index322++) {
            result = result + inputs[index322] * ownWeights[index322]
        }
        result = result + ownBias
        serial.writeValue("output " + ownName, sigmoid(result))
        return sigmoid(result)
    }
    if (ownName.includes("y")) {
        for (let index3222 = 0; index3222 <= ownWeights.length; index3222++) {
            result = result + inputs[index3222] * ownWeights[index3222]
        }
        return result
    }
    return 0
}
let result = 0
let ownBias = 0
let ownWeights: number[] = []
let ownName = ""
let time = 0
let m = 0
let x = 0
let c = 0
let l = 0
let s = 0
let h = 0
let timeout = 0
let maxWeights = 0
let listen = 0
listen = 0
maxWeights = 4
timeout = 1
basic.forever(function () {
	
})
