"""gtl-contract — the entity-contract checker for gimme-the-lint.

A model and the schemas that expose it are two descriptions of the same thing. When
they disagree, the application does not crash; it quietly saves the wrong data,
returns the wrong shape, or drops a field and answers 201. That silence is what
makes contract drift expensive: nobody finds it until a user notices their work is
gone.

This package reads an application and reports where the two descriptions have come
apart. It knows nothing about baselines, fingerprints, or git — that is the engine's
job. It is a linter, and its output is just violations.
"""

__version__ = "2.6.0"
