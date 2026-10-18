"""Create isolated writable git worktrees; never change the source checkout."""
import json, subprocess
from pathlib import Path
BASE = Path(__file__).resolve().parent
ROLES = ["coordinador", "backend", "frontend", "integraciones", "qa"]
def run(*args):
    return subprocess.check_output(args, text=True).strip()
def prepare():
    source = BASE.parent / "HackatonUC2026"
    state = BASE / ".state"
    state.mkdir(mode=0o700, exist_ok=True)
    state.chmod(0o700)
    repo = state / "repo"
    if not repo.exists():
        subprocess.run(["git", "-c", "safe.directory=" + str(source / ".git"), "clone", "--no-hardlinks", str(source), str(repo)], check=True)
        # Prevent accidental push to the shared original.
        subprocess.run(["git", "-C", str(repo), "remote", "remove", "origin"], check=True)
    paths_file = state / 'workspaces.json'
    paths = json.loads(paths_file.read_text()) if paths_file.exists() else {}
    for role in ROLES:
        target = state / "worktrees" / role
        if not target.exists():
            subprocess.run(["git", "-C", str(repo), "worktree", "add", "-b", "paperclip/" + role, str(target)], check=True)
        if not (target / "PLAN-ANGIBELL360.md").is_file():
            raise SystemExit("Falta el plan maestro en " + str(target))
        paths[role] = str(target)
    (state / "workspaces.json").write_text(json.dumps(paths, indent=2) + "\n")
    print("Worktrees preparados. Original conservado: " + str(source))
if __name__ == "__main__": prepare()
