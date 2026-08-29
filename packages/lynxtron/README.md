# @lynxship/lynxtron

Desktop/Lynxtron artifact contracts with SHA-256 verification and explicit target matching. It does not implement a Lynxtron runtime; the real Lynxtron host remains responsible for loading the verified bundle.

## Usage and security

Validate the artifact manifest and target before handing a file to the host.
Only content whose bytes match the declared SHA-256 may be accepted. The
package does not load arbitrary native `.node` files, execute downloaded code,
or provide a desktop runtime. The host must apply its own signature policy and
platform sandboxing.
