// expect: done "dejado"
// look: typeof Object.getOwnPropertyDescriptor($json, "trampa")
// A getter left on a row of the batch would run in the next row's evaluation: it is left on this one's copy.
Object.defineProperty($input.all()[1], "trampa", { get: () => 1 });
return "dejado";
