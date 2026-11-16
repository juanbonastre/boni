// expect: done [1794817800000,1794817800000,1794817800000,1794817800000]
// No clock of its own: the instant is the request's, at the start as at the end.
const a = Date.now();
let x = 0;
for (let i = 0; i < 200000; i++) x += i;
return [a, new Date().getTime(), $now.toMillis(), Date.now()];
