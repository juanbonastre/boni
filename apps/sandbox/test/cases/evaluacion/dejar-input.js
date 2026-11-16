// expect: frozen|threw
// look: typeof $input.all.dejado
// A function of $input is shared by every row of the batch.
$input.all.dejado = 1;
return "dejado";
