// expect: threw|result
// A module imported at run time is not there either: it fails, or it is a promise that never comes.
return import("node:fs");
