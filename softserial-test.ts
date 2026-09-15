// ============================================================
//  MINIMAL SOFTSERIAL TEST  --  temporary diagnostic, not part of the network.
//
//  Purpose: find out whether softSerial still works at all in the current
//  setup, with NO radio in the program. `nn.js` (which had working cables)
//  never called radio.setGroup; neuron.ts calls it before registering the
//  softSerial pins. Radio and bit-banged softSerial compete for timing, so
//  the radio stack is the prime suspect for killing reception.
//
//  Flash this to TWO boards, wire them TX -> RX plus a COMMON GROUND, then:
//     press A  -> this board transmits 0.5 on P3
//     receive  -> the other board lights a dot and logs the raw line
//
//  Read the result like this:
//    works here, fails in neuron.ts  -> radio is the conflict
//    fails here too                  -> the pins/cable/ground, not the code
//
//  STEP 2: uncomment the radio.setGroup line below and reflash. If reception
//  stops, the conflict is proven and neuron.ts needs the radio and softSerial
//  separated (e.g. only the x boards talk radio, values move by cable only).
// ============================================================

// radio.setGroup(1)        // <-- STEP 2: uncomment to test the radio conflict

let rxCount = 0

// Receive on P0. One dot per line received, so no serial monitor is needed.
softSerial.onLine(DigitalPin.P0, softSerial.BaudRate.Baud1200, function (line) {
    basic.pause(10)
    rxCount = rxCount + 1
    serial.writeLine("RX P0 raw: [" + line + "]  count=" + rxCount)
    // Instant feedback only -- never scroll here, it would eat the next line.
    led.plot(0, 2)
    led.plot(1, 2)
})

// A transmits a known value on P3.
input.onButtonEvent(Button.A, input.buttonEventClick(), function () {
    serial.writeLine("TX P3: 0.5")
    led.plot(4, 0)
    softSerial.writeLine(DigitalPin.P3, softSerial.BaudRate.Baud1200, convertToText(0.5))
    basic.pause(200)
    led.unplot(4, 0)
})

// B reports how many lines this board has received, as dots (never scrolls).
input.onButtonEvent(Button.B, input.buttonEventClick(), function () {
    serial.writeLine("received so far: " + rxCount)
    basic.clearScreen()
    for (let i = 0; i <= rxCount - 1 && i <= 4; i++) {
        led.plot(i, 4)
    }
})

// Alive marker: a single corner dot, drawn instantly.
basic.clearScreen()
led.plot(4, 4)
serial.writeLine("softserial-test ready: A = send 0.5 on P3, B = show count")
