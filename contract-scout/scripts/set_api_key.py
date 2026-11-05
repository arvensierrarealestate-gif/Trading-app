"""Write an Anthropic API key into .env (creating it from .env.example if needed).

Usage: python scripts/set_api_key.py sk-ant-...
The key is written only to .env in the project folder and never printed.
"""
from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    if len(sys.argv) < 2 or not sys.argv[1].strip():
        print("No key given; nothing changed.")
        return 1
    key = sys.argv[1].strip().strip('"').strip("'")
    if not key.startswith("sk-ant-"):
        print("That does not look like an Anthropic key (it should start with sk-ant-). Nothing changed.")
        return 1
    env = ROOT / ".env"
    if not env.exists():
        shutil.copy(ROOT / ".env.example", env)
    text = env.read_text(encoding="utf-8")
    if re.search(r"^ANTHROPIC_API_KEY=", text, re.M):
        text = re.sub(r"^ANTHROPIC_API_KEY=.*$", "ANTHROPIC_API_KEY=" + key, text, count=1, flags=re.M)
    else:
        text = text.rstrip("\n") + "\nANTHROPIC_API_KEY=" + key + "\n"
    env.write_text(text, encoding="utf-8")
    print(f"Key saved to {env} ({len(key)} characters).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
