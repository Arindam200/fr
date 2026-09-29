# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Instead, report them privately
through GitHub's [private vulnerability reporting](https://github.com/Arindam200/fr/security/advisories/new).
You should get a response within a few days.

## Data handling

`fr` sends each scanned file's path and a short preview of its contents (up to ~1,500
characters) to the TypeSafe API for every question. It never reads hidden files such as
`.env`. Your API key is only sent to the endpoint set by `JEV_URL`.
