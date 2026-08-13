# W4-A Public Export Inventory

## Canonical boundary

`src/contracts/index.ts` is the browser-consumable public entrypoint. `src/contracts/domain.ts` owns shared domain types and contains no Node or runtime imports; `src/contracts/facade.ts` owns the 17-method Facade DTO surface. `src/application/learning-runtime-facade.ts` is a W3 compatibility re-export only. Runtime and repository modules depend on contracts, never the reverse.

## Public contract groups

| Area | Canonical exports |
| --- | --- |
| Shared domain | `ActivityResult`, `Evidence`, `KnowledgeState`, `LearnerDiagnostic`, `LearningRuntimeErrorCode`, `Difficulty`, `ScaffoldLevel`, `ActivityPolicy`, Profile v2 asset types, `RevisionSeal` |
| Profile/card/quiz assets | `Revision3KnowledgePointFields`, `LearningCardSafeView`, legacy/group `McqActivityAsset`, `QuizQuestionGroupAsset`, `QuizAnswerKeyAsset` |
| Quiz runtime | `QuizActivitySafeView`, `QuizAnswerInput`, `QuizSubmitActivityInput`, `QuizActivityResult` |
| Diagnostic | `BackgroundQuestionnaire`, `DiagnosticDraftVersion`, `DiagnosticQuestionSafeView`, `DiagnosticSafeEnvelope`, `DiagnosticDraftSafeView` |
| Progress/recovery | `ActivityProgressEntry`, `NodeActivityProgress`, `CurrentAttemptSafeReference`, `SessionRecoverySafeView` |
| Activity discriminated unions | `ActivityDraftOutput`, `SubmitActivityInput`, `ActivitySubmissionOutput`, `ActivityAttemptSafeView` with outer `kind: "code" | "quiz"` |
| Path/bootstrap | required-field `PathNodeSafeView`, `ReplanPathOutput.changeReasons`, `AppBootstrapSafeView`, `AppBootstrapFacade` |
| A/D ports | `AdaptiveContentPort`, `CapabilityTaskPort`, `createDeterministicContentPort`, `createEmptyCapabilityTaskPort` |

Public write DTOs exclude derived `Evidence`, `KnowledgeState`, path and progress candidates. Open and recovery safe views exclude private answers, Rubric, hidden tests, reference solutions, host paths and transaction objects. Bootstrap constructs all nested objects from field allowlists.

## Importable implementations

| Consumer need | Export/source |
| --- | --- |
| 17-method composition | `ComposedLearningRuntimeFacade` in `src/application/composed-learning-runtime-facade.ts` |
| Read-only bootstrap | `FileAppBootstrapFacade` in `src/application/app-bootstrap-facade.ts` |
| Code activity bridge | `CodeActivityFacadeAdapter`, `ProfileFamilyCodeActivityAssetResolver` |
| Quiz bridge | `QuizActivityRuntime`, `ProfileFamilyQuizActivityAssetResolver`, `DeterministicQuizRuntime` |
| Path suffix | `ActivityPathSuffixReplanner`, `createActivityPathSuffixReplanner` |
| Deterministic content validation | `selectDeterministicCard`, `selectDeterministicQuizContent` |
| Revision 3 activation | `ProfileFamilyRepository.activateRevision3Draft()` |

## Consumer boundary

- B supplies formal revision 3 content/private keys/seal and consumes the asset contracts.
- D implements the two ports; A remains authoritative for validation and derived facts.
- C imports contracts plus Facade implementations and does not copy DTOs.
- E imports contracts only. This remediation changes only the owner-approved `src/web/mocks/safe-dtos.ts` and `tests/web/dto-contract.test.ts` to restore that import boundary.
