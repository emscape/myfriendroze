# Observation Techniques

OBSERVE = EXECUTE, not code read.

| Source | Reveals |
|--------|---------|
| Code reading | What someone INTENDED |
| Execution | What ACTUALLY happens |

---

## Technique Matrix

| System Type | Execute Via | Capture |
|-------------|-------------|---------|
| CLI | Run all flags/subcommands | stdout, stderr, exit codes, file changes |
| Web App | Browser automation (Playwright, Selenium, Puppeteer) | DOM state, network calls, screenshots |
| REST/GraphQL API | HTTP client to all endpoints | Responses, status codes, timing |
| Library/Module | Throwaway test harness | Returns, exceptions, state mutations |
| Database | Query before/after operations | Row deltas, constraint behavior |
| Message Queue | Produce/consume test messages | Shapes, routing, acknowledgments |
| File System | Execute + diff directories | Created/modified/deleted files |
| Logs | Execute + tail logs | Errors, state transitions, timing |

---

## Patterns

### CLI Observation
```bash
# Principle: Enumerate all commands, capture all outputs
for cmd in $(./tool --help | grep -E '^\s+\w+' | awk '{print $1}'); do
  ./tool $cmd --help > obs/${cmd}_help.txt 2>&1
  ./tool $cmd [valid-args] > obs/${cmd}_valid.txt 2>&1; echo "exit: $?" >> obs/${cmd}_valid.txt
  ./tool $cmd [invalid-args] > obs/${cmd}_invalid.txt 2>&1; echo "exit: $?" >> obs/${cmd}_invalid.txt
done
```

### Web Observation
```javascript
// Principle: Navigate all routes, capture state at each
const routes = ['/', '/login', '/dashboard'];
for (const route of routes) {
  await page.goto(baseUrl + route);
  await page.screenshot({path: `obs/${route.replace(/\//g, '_')}.png`});
  observations.push({route, title: await page.title(), forms: await page.$$('form')});
}
```

### API Observation
```bash
# Principle: Hit all endpoints, capture responses
curl -s $BASE/users | jq > obs/users_get.json
curl -s -X POST $BASE/users -d '{"name":"test"}' | jq > obs/users_post.json
curl -s $BASE/users/1 | jq > obs/users_1_get.json
```

### Log Observation
```bash
# Principle: Capture logs DURING execution
tail -f /var/log/app.log > obs/during.log &
PID=$!
./execute-operations
kill $PID
grep -E "(ERROR|WARN)" obs/during.log > obs/issues.log
```

---

## Principle Summary

1. **Identify system type** → Select technique from matrix
2. **Build harness** → Script that systematically exercises all interfaces
3. **Execute** → Run harness, capture outputs
4. **Document** → OBSERVED column comes from execution artifacts, never code reading
