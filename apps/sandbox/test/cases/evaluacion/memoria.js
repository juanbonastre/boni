// expect: call memory
// limits: {"memoryBytes": 8388608, "ms": 10000}
// Asking for more and more memory stops at its limit: the interpreter's memory cannot grow past it. The case asks
// for a small memory and the most time, so it ends by memory however slow or loaded the machine, as its twin of the
// run protocol does (test/cases/memoria.js): 8 MB are passed in about eight rounds of 1 MB, and the door waits 10 s
// and its grace. With the defaults (64 MB, 1 s) it once ended by time: under a load of two busy threads per core,
// filling 64 MB took the worker more than its 1 s (task 146).
const all = [];
for (;;) all.push("x".repeat(1 << 20) + all.length);
