#!/usr/bin/env python3
"""Create (or update) the GitHub Release for a tag and attach the bundle + source map.

Replaces softprops/action-gh-release. Needs GH_TOKEN (Contents: read/write on the repo).
usage: github-release.py <version without v> <sri string>
"""
import json
import os
import sys
import urllib.error
import urllib.request

REPO = "Vocadesk/embed-sdk"
version, sri = sys.argv[1], sys.argv[2]
tag = f"v{version}"
url = f"https://cdn.vocadesk.com/embed/v{version}/vocadesk.min.js"
body = f"""## CDN URL

```
{url}
```

## SRI hash

```
{sri}
```

## Snippet

```html
<script
  src="{url}"
  integrity="{sri}"
  crossorigin="anonymous"
  defer
></script>
```
"""


def call(method, endpoint, data=None, raw=None, ctype="application/json", base="https://api.github.com"):
    payload = raw if raw is not None else (json.dumps(data).encode() if data is not None else None)
    req = urllib.request.Request(base + endpoint, data=payload, method=method)
    req.add_header("Authorization", "Bearer " + os.environ["GH_TOKEN"])
    req.add_header("Accept", "application/vnd.github+json")
    if payload is not None:
        req.add_header("Content-Type", ctype)
    with urllib.request.urlopen(req) as r:
        txt = r.read()
        return json.loads(txt) if txt else {}


try:
    rel = call("GET", f"/repos/{REPO}/releases/tags/{tag}")
    rel = call("PATCH", f"/repos/{REPO}/releases/{rel['id']}", {"name": tag, "body": body})
    print("updated existing release", tag)
except urllib.error.HTTPError as e:
    if e.code != 404:
        raise
    rel = call("POST", f"/repos/{REPO}/releases", {"tag_name": tag, "name": tag, "body": body})
    print("created release", tag)

existing = {a["name"]: a["id"] for a in rel.get("assets", [])}
for name, ctype in (("vocadesk.min.js", "text/javascript"), ("vocadesk.min.js.map", "application/json")):
    if name in existing:
        call("DELETE", f"/repos/{REPO}/releases/assets/{existing[name]}")
    with open(f"dist/{name}", "rb") as f:
        call("POST", f"/repos/{REPO}/releases/{rel['id']}/assets?name={name}", raw=f.read(),
             ctype=ctype, base="https://uploads.github.com")
    print("attached", name)
