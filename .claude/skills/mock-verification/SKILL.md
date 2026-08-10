# Mock Verification Detection Skill

## Purpose
Detect and prevent mock theater - mocks that behave differently from real providers, causing tests to pass while production fails.

## The orphaned_at Lesson

Tests mocked `psycopg2.connect` and assumed `orphaned_at` column existed.
Migration was documented in plan but never created.
**Tests passed. Production failed.**

Root cause: Mock invented database schema instead of deriving from verified contract.
Prevention: Contract verification test would have failed because real database lacked column.

---

## Core Detection Question

**"Can this MOCK behave differently from the REAL PROVIDER and tests still pass?"**

- If YES → **MOCK THEATER** → REJECT immediately
- If NO (contract verified) → PROCEED

---

## Detection Criteria

### Mock Theater Anti-Patterns (REJECT if found)

- [ ] Hand-written mock that invents return values without contract
- [ ] Mock that assumes database column exists (MUST verify schema via contract)
- [ ] Mock that assumes API response format (MUST verify via contract test)
- [ ] Copying mock from another test without verifying contract applicability
- [ ] Mock that doesn't enforce preconditions (accepts invalid input)
- [ ] Mock return values not derived from contract postconditions
- [ ] Mock that ignores error conditions the real provider would raise

### Valid Mock Patterns (ACCEPT)

- [ ] Mock derived from verified contract file
- [ ] Contract verification test passes in CI
- [ ] Mock enforces same preconditions as real provider
- [ ] Mock simulates postconditions documented in contract
- [ ] Test docstring references contract file and verification date
- [ ] Mock raises same exceptions as real provider for invalid input

---

## Contract Format

```python
# contracts/database.contract.py
"""
Database Contract: semantic_search.memory_events table

Preconditions:
- Connection established to PostgreSQL
- semantic_search schema exists

Postconditions:
- INSERT returns row with all columns (including orphaned_at)
- SELECT returns rows matching query
- orphaned_at column accepts NULL or TIMESTAMP WITH TIME ZONE

Invariants:
- Column types match migration schema
- Foreign key constraints enforced
- Primary key auto-increments
"""

# Schema definition (source of truth for mocks)
MEMORY_EVENTS_SCHEMA = {
    "table": "semantic_search.memory_events",
    "columns": {
        "id": "SERIAL PRIMARY KEY",
        "commit_hash": "VARCHAR(40) NOT NULL",
        "parent_hash": "VARCHAR(40)",
        "orphaned_at": "TIMESTAMP WITH TIME ZONE DEFAULT NULL",  # <-- THIS WAS MISSING
        "created_at": "TIMESTAMP WITH TIME ZONE DEFAULT NOW()",
    },
    "indexes": [
        "idx_memory_events_orphaned ON memory_events(orphaned_at) WHERE orphaned_at IS NOT NULL"
    ]
}

# Error conditions (mock must simulate these)
EXPECTED_ERRORS = {
    "missing_schema": "relation \"semantic_search.memory_events\" does not exist",
    "invalid_commit_hash": "value too long for type character varying(40)",
    "fk_violation": "violates foreign key constraint",
}
```

---

## Verification Test Example

```python
# tests/contracts/test_database_contract.py
import pytest
from contracts.database import MEMORY_EVENTS_SCHEMA, EXPECTED_ERRORS

@pytest.mark.contract
def test_memory_events_schema_matches_contract(real_db_connection):
    """
    Verify database schema matches contract.

    Contract: contracts/database.contract.py
    """
    cursor = real_db_connection.cursor()
    cursor.execute("""
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'semantic_search'
        AND table_name = 'memory_events'
    """)
    actual_columns = {row[0]: row[1] for row in cursor.fetchall()}

    for col_name in MEMORY_EVENTS_SCHEMA["columns"]:
        assert col_name in actual_columns, (
            f"Column '{col_name}' missing from database.\n"
            f"Contract: contracts/database.contract.py\n"
            f"Expected columns: {list(MEMORY_EVENTS_SCHEMA['columns'].keys())}\n"
            f"Actual columns: {list(actual_columns.keys())}\n"
            f"Guidance: Run migration to add missing column."
        )

@pytest.mark.contract
def test_error_conditions_match_contract(real_db_connection):
    """Verify error messages match contract expectations."""
    cursor = real_db_connection.cursor()

    # Test FK violation produces expected error
    with pytest.raises(Exception) as exc_info:
        cursor.execute("""
            INSERT INTO semantic_search.memory_events (commit_hash, parent_hash)
            VALUES ('invalid', 'nonexistent_parent')
        """)

    assert "foreign key" in str(exc_info.value).lower(), (
        f"Error message doesn't match contract.\n"
        f"Expected: Contains 'foreign key'\n"
        f"Actual: {exc_info.value}\n"
        f"Contract: contracts/database.contract.py"
    )
```

---

## Mock Derivation Example

```python
# tests/mocks/database_mock.py
"""
Mock derived from contracts/database.contract.py
Contract verified: 2025-12-04, CI run #1234

DO NOT hand-write return values. Derive from contract.
"""
from contracts.database import MEMORY_EVENTS_SCHEMA, EXPECTED_ERRORS
from unittest.mock import MagicMock

def create_memory_events_mock():
    """Create mock that enforces contract preconditions/postconditions."""
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_conn.cursor.return_value = mock_cursor

    def execute_side_effect(query, params=None):
        # Enforce preconditions (contract specifies commit_hash max length)
        if params and len(params.get('commit_hash', '')) > 40:
            raise Exception(EXPECTED_ERRORS['invalid_commit_hash'])

        # Simulate postconditions (return row with ALL columns from contract)
        if 'INSERT' in query:
            return {col: None for col in MEMORY_EVENTS_SCHEMA['columns'].keys()}

    mock_cursor.execute.side_effect = execute_side_effect
    return mock_conn
```

---

## Evidence Recording

When mocks are used in tests, record:

```
Contract: contracts/database.contract.py
Verification: tests/contracts/test_database_contract.py
Status: VERIFIED (2025-12-04, CI run #1234)
```

If contract doesn't exist:
```
Contract: MISSING - CONSTITUTIONAL VIOLATION (CL10)
Action: Write contract before proceeding
```

---

## Integration with Think Tools

The following Serena think tools now include mock verification checks:

1. **think_about_collected_information**: "Do contracts exist for planned mocks?"
2. **think_about_task_adherence**: "Can mock behave differently from real provider?"
3. **think_about_whether_you_are_done**: "All mocks have verified contracts?"
4. **summarize_changes**: "Mock contract status for each mock used"

---

## Quick Reference

| Check | Question | Violation If |
|-------|----------|--------------|
| Contract Exists | Is there a contracts/ file? | NO |
| Verification Test | Is there a tests/contracts/ file? | NO |
| CI Passing | Does contract test pass in CI? | NO |
| Mock Derived | Does mock import from contract? | Hand-written values |
| Preconditions | Does mock enforce input validation? | Accepts invalid input |
| Postconditions | Does mock return contract-defined structure? | Invents structure |
| Error Simulation | Does mock raise contract-defined errors? | Ignores errors |

<!-- © 2024-2026 Ketema Harris. All rights reserved. SPDX-License-Identifier: LicenseRef-CCABDD-Proprietary -->
