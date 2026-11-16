// expect: frozen
// The interpreter's prototypes cannot be changed, so nothing is left for the next row.
Array.prototype.first = function () { return this[0]; };
return [].first();
