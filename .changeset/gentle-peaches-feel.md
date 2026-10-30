---
'@naulabsco/errors': minor
---

Add a framework-free `./domain` entry point that re-exports `DomainError` without loading `@nestjs/common`, so a domain layer can import it directly. The root entry keeps its current surface.
