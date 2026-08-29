# @lynxship/test-kit

Portable contracts for planning and running declared Lynx project tests. It does not emulate Android, iOS, HarmonyOS, or Lynx Runtime; a host must provide the real test runner. This keeps a passing plan from being mistaken for native proof.

The runtime test environment follows the official Lynx testing surface: <https://lynxjs.org/api/lynx-testing-environment/>.

## Usage and boundaries

Declare the commands and environment required by a project, create a plan,
and inject a process runner for execution. The plan is deterministic and stops
on the first failed step. A successful JavaScript test plan is not evidence of
a native device build, store submission, permission prompt or cloud worker;
those require the real platform host and credentials.
