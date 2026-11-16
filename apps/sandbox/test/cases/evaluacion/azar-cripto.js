// expect: threw
// No chance but the seeded one: there is no crypto.
return crypto.getRandomValues(new Uint8Array(4));
