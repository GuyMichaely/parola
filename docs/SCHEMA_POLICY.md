# Schema policy

Treat each release as if it were a fresh 1.0 design. Do not keep old fields, readers, aliases, fallback branches, or compatibility code just because an earlier Parola release used them.

When the clean current model requires a breaking data change, preserve real user data with a one-time migration. The migration may be a script, transformed export, or explicit instructions supplied for that upgrade. It should not become part of the application's permanent runtime unless there is a separate current-version reason for it to exist.

After the user's data has been converted, the repository should contain only the new canonical schema and code that uses it.

Transient local state may be discarded when preserving it has no value.

Before making a breaking change, inspect the user's current exported inventory when available and provide the required one-time conversion before asking the user to import or use the new schema.
