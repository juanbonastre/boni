// expect: result
// What JSON cannot say is not a value.
const o = {};
o.o = o;
return o;
