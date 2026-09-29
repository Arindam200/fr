# Architecture

The API talks to Postgres through a shared connection pool (see src/db/pool.ts).
Sessions are stateless tokens issued at login. Billing is a pure function over line items.
