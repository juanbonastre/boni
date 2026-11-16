// expect: call steps|timeout
// An expression that backtracks for ever is stopped (by its steps, or ended from outside).
return /^(a+)+$/.test("a".repeat(40) + "!");
