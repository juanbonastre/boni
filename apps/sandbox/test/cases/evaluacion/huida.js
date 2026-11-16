// expect: threw
// A source cannot close the function it is put in and run outside it: it does not parse.
}); globalThis.fuera = 1; (function () {
