import { z } from "zod";

// SEC-WEB-003: the CSP has no 'unsafe-eval'. Zod 4 builds object parsers with `new Function` when it detects that
// eval is allowed, and under a strict CSP even that caught probe is reported as a `securitypolicyviolation`. A schema
// reads this flag when it is created, so this module must be evaluated before any module that defines a schema:
// src/main.tsx imports it first. Parsing stays correct without the generated fast path.
z.config({ jitless: true });
