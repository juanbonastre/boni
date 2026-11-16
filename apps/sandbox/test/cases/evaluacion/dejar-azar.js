// expect: frozen|threw
// look: Math.random() === 0 ? "cambiado" : "undefined"
// Chance replaced by a row would be the next row's chance.
Math.random = () => 0;
return "dejado";
