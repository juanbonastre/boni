// expect: threw
// Calling itself forever ends at its stack, as the code's own error.
const f = () => f() + 1;
return f();
