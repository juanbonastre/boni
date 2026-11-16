// expect: done [1,1]
// The rows it is given are its own copy: it may change them, and what it returns is what the step gives (AU-37).
for (const fila of $input.all()) fila.i = 1;
return $input.all().map((fila) => fila.i);
