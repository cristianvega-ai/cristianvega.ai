#!/usr/bin/env python3
"""Deployment receiver for cristianvega.ai.

One restricted SSH key on the web host may run this program, and nothing
else. The program reads one gzip-compressed tar package of static site files
from standard input, checks it, and publishes it into the document root.

It rejects anything that is not a plain static site file. It refuses a
.htaccess that does not match a copy approved by hand on the host. On a
rejection nothing in the document root changes. If the live check after
publishing fails, the previous site comes back.

The program needs Python 3.8 or newer and only the standard library.

The forced command in authorized_keys runs it as:

    cristianvega-deploy-receiver --config /path/to/config.json

It accepts two values of SSH_ORIGINAL_COMMAND:

    version   print "RECEIVER <sha256 of this file>" and exit 0
    deploy    read one package from standard input and publish it

Exit codes: 0 published, 1 rejected or failed, 2 bad configuration.

Tests live beside this file in scripts/test_deploy_receiver.py.
"""

import argparse
import fcntl
import hashlib
import io
import json
import os
import re
import secrets
import shutil
import ssl
import stat
import sys
import tarfile
import time
import urllib.error
import urllib.request

try:
    import resource
except ImportError:  # pragma: no cover - not a supported platform
    resource = None

RECEIVER_PATH = os.path.realpath(__file__)
TEMP_PREFIX = ".deploy-tmp-"
ENTRY_POINT_SUFFIXES = frozenset({"html", "xml"})

# A name component after the first dot that Apache could hand to an
# interpreter. `payload.php.jpg` has an allowed suffix and is still refused.
FORBIDDEN_COMPONENTS = frozenset(
    {
        "php", "php3", "php4", "php5", "php7", "php8", "phtml", "phar", "phps", "pht",
        "cgi", "fcgi", "pl", "py", "rb", "sh", "bash", "zsh",
        "shtml", "shtm", "stm", "inc", "ini", "user",
        "htaccess", "htpasswd", "htgroups", "asp", "aspx", "jsp", "cfm",
        "exe", "dll", "so",
    }
)

REQUIRED_HEADERS = (
    "x-content-type-options",
    "x-frame-options",
    "referrer-policy",
    "permissions-policy",
    "strict-transport-security",
    "content-security-policy",
)
REQUIRED_CSP_DIRECTIVES = (
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
)
MIN_HSTS_MAX_AGE = 31536000

LIMIT_KEYS = (
    "compressed_bytes",
    "expanded_bytes",
    "file_bytes",
    "members",
    "path_bytes",
    "component_bytes",
    "cpu_seconds",
    "memory_bytes",
    "http_timeout_seconds",
)


class ConfigError(Exception):
    """The configuration file is unusable."""


class Rejected(Exception):
    """The request or the package is not acceptable. Nothing changed."""


class Failed(Exception):
    """Publishing did not complete, or the live check failed."""


# --------------------------------------------------------------------------- output


def err(message):
    print("deploy-receiver: " + message, file=sys.stderr)
    sys.stderr.flush()


def receiver_sha256():
    with open(RECEIVER_PATH, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


# --------------------------------------------------------------------------- config


def _absolute_dir(data, key):
    value = data.get(key)
    if not isinstance(value, str) or not os.path.isabs(value):
        raise ConfigError("%s must be an absolute path" % key)
    return os.path.normpath(value)


def _inside(path, parent):
    try:
        return os.path.commonpath([path, parent]) == parent
    except ValueError:
        return False


def load_config(path):
    try:
        with open(path, "rb") as handle:
            data = json.load(handle)
    except (OSError, ValueError) as exc:
        raise ConfigError("cannot read %s: %s" % (path, exc))
    if not isinstance(data, dict):
        raise ConfigError("the configuration must be a JSON object")

    cfg = {}
    for key in ("web_root", "state_dir", "approved_dir"):
        cfg[key] = _absolute_dir(data, key)
    for key in ("state_dir", "approved_dir"):
        if _inside(cfg[key], cfg["web_root"]) or _inside(cfg["web_root"], cfg[key]):
            raise ConfigError("%s must not overlap web_root" % key)

    origin = data.get("origin")
    if not isinstance(origin, str) or not re.match(r"^https?://[A-Za-z0-9.-]+(:[0-9]+)?$", origin):
        raise ConfigError("origin must be a scheme and host with no path")
    require_tls = data.get("require_tls", True)
    if not isinstance(require_tls, bool):
        raise ConfigError("require_tls must be true or false")
    if require_tls and not origin.startswith("https://"):
        raise ConfigError("origin must use https when require_tls is true")
    cfg["origin"] = origin
    cfg["require_tls"] = require_tls

    preserve = data.get("preserve", [])
    if not isinstance(preserve, list) or not all(
        isinstance(item, str) and item and "/" not in item and item not in (".", "..")
        for item in preserve
    ):
        raise ConfigError("preserve must be a list of top-level names")
    cfg["preserve"] = frozenset(preserve)

    suffixes = data.get("allowed_suffixes")
    if not isinstance(suffixes, list) or not suffixes or not all(
        isinstance(item, str) and re.match(r"^[a-z0-9]+$", item) for item in suffixes
    ):
        raise ConfigError("allowed_suffixes must be a list of lowercase suffixes")
    if FORBIDDEN_COMPONENTS & set(suffixes):
        raise ConfigError("allowed_suffixes names a forbidden suffix")
    cfg["allowed_suffixes"] = frozenset(suffixes)

    required = data.get("required_files")
    if not isinstance(required, list) or not required or not all(
        isinstance(item, str) and item and not item.startswith("/") for item in required
    ):
        raise ConfigError("required_files must be a list of relative paths")
    cfg["required_files"] = tuple(required)

    keep = data.get("snapshots_to_keep", 3)
    if not isinstance(keep, int) or isinstance(keep, bool) or keep < 1:
        raise ConfigError("snapshots_to_keep must be a positive integer")
    cfg["snapshots_to_keep"] = keep

    limits = data.get("limits")
    if not isinstance(limits, dict):
        raise ConfigError("limits must be an object")
    for key in LIMIT_KEYS:
        value = limits.get(key)
        if not isinstance(value, int) or isinstance(value, bool) or value < 1:
            raise ConfigError("limits.%s must be a positive integer" % key)
    if limits["file_bytes"] > limits["expanded_bytes"]:
        raise ConfigError("limits.file_bytes must not exceed limits.expanded_bytes")
    cfg["limits"] = {key: limits[key] for key in LIMIT_KEYS}
    return cfg


# --------------------------------------------------------------------------- process


def set_limits(limits):
    if resource is None:
        return
    for name, value in (("RLIMIT_CPU", limits["cpu_seconds"]), ("RLIMIT_AS", limits["memory_bytes"])):
        which = getattr(resource, name, None)
        if which is None:
            continue
        try:
            resource.setrlimit(which, (value, value))
        except (ValueError, OSError):
            # The platform refuses this limit. The timeout in the forced
            # command still bounds the run.
            pass


def private_dir(path):
    os.makedirs(path, 0o700, exist_ok=True)
    os.chmod(path, 0o700)


def public_dir(path):
    os.makedirs(path, 0o755, exist_ok=True)
    os.chmod(path, 0o755)


def acquire_lock(path):
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        os.close(fd)
        raise Rejected("another deploy is running")
    return fd


def read_package(limit):
    data = sys.stdin.buffer.read(limit + 1)
    if len(data) > limit:
        raise Rejected("package exceeds %d bytes" % limit)
    if not data:
        raise Rejected("package is empty")
    return data


def append_log(state_dir, record):
    path = os.path.join(state_dir, "deploy.log")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(record, sort_keys=True) + "\n")


# --------------------------------------------------------------------------- package checks


def normalize_name(name, limits):
    """Return the package-relative path for a tar entry name, or raise Rejected.

    `tar --directory dist .` writes names like `./index.html` and `./`; the
    leading `.` component is dropped. The root entry itself becomes ``.
    """
    if len(name.encode("utf-8", "surrogateescape")) > limits["path_bytes"]:
        raise Rejected("path is longer than %d bytes" % limits["path_bytes"])
    if "\\" in name:
        raise Rejected("path contains a backslash: %r" % name)
    if any(ord(char) < 0x20 or ord(char) > 0x7E for char in name):
        raise Rejected("path contains a control or non-ASCII character: %r" % name)
    if name.startswith("/"):
        raise Rejected("absolute path: %r" % name)

    parts = name.split("/")
    if parts and parts[0] == ".":
        parts = parts[1:]
    if parts and parts[-1] == "":
        parts = parts[:-1]
    if not parts:
        return ""
    for part in parts:
        if part in ("", ".", ".."):
            raise Rejected("bad path component in %r" % name)
        if len(part) > limits["component_bytes"]:
            raise Rejected("path component longer than %d bytes" % limits["component_bytes"])
    return "/".join(parts)


def check_components(rel):
    """No hidden names anywhere, except the one .htaccess at the root."""
    if rel == ".htaccess":
        return
    for part in rel.split("/"):
        if part.startswith("."):
            raise Rejected("hidden name is not allowed: %r" % rel)


def check_filename(rel, cfg):
    if rel == ".htaccess":
        return
    base = rel.rsplit("/", 1)[-1]
    if "." not in base:
        raise Rejected("file has no suffix: %r" % rel)
    parts = base.split(".")
    if parts[-1] not in cfg["allowed_suffixes"]:
        raise Rejected("suffix is not allowed: %r" % rel)
    for component in parts[1:]:
        if component.lower() in FORBIDDEN_COMPONENTS:
            raise Rejected("forbidden suffix component: %r" % rel)


def inspect_members(tar, cfg):
    """Validate every entry before anything is extracted.

    Returns (entries, file_count, total_bytes) where entries is a list of
    (kind, relative_path, member) and kind is 'dir' or 'file'.
    """
    limits = cfg["limits"]
    entries = []
    seen = set()
    folded = set()
    count = 0
    files = 0
    total = 0
    for member in tar:
        count += 1
        if count > limits["members"]:
            raise Rejected("more than %d entries" % limits["members"])
        rel = normalize_name(member.name, limits)
        for key in member.pax_headers:
            if "xattr" in key.lower():
                raise Rejected("extended attributes are not allowed: %r" % member.name)
        if member.isdir():
            kind = "dir"
        elif member.isreg():
            kind = "file"
        else:
            raise Rejected("entry is not a plain file or directory: %r" % member.name)
        if rel == "":
            if kind != "dir":
                raise Rejected("the root entry must be a directory")
            continue
        if rel in seen:
            raise Rejected("duplicate path: %r" % rel)
        if rel.lower() in folded:
            raise Rejected("path differs only by case from another entry: %r" % rel)
        seen.add(rel)
        folded.add(rel.lower())
        check_components(rel)
        if kind == "file":
            check_filename(rel, cfg)
            if member.mode & (stat.S_ISUID | stat.S_ISGID | stat.S_ISVTX | 0o111):
                raise Rejected("file has executable or special mode bits: %r" % rel)
            if member.size > limits["file_bytes"]:
                raise Rejected("file is larger than %d bytes: %r" % (limits["file_bytes"], rel))
            files += 1
            total += member.size
            if total > limits["expanded_bytes"]:
                raise Rejected("package expands beyond %d bytes" % limits["expanded_bytes"])
        entries.append((kind, rel, member))
    return entries, files, total


def extract_entries(tar, entries, staging):
    for kind, rel, member in entries:
        dest = os.path.join(staging, *rel.split("/"))
        try:
            if kind == "dir":
                private_dir(dest)
                continue
            private_dir(os.path.dirname(dest))
            source = tar.extractfile(member)
            if source is None:
                raise Rejected("entry has no data: %r" % rel)
            fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "wb") as out, source:
                remaining = member.size
                while remaining:
                    chunk = source.read(min(65536, remaining))
                    if not chunk:
                        raise Rejected("entry is truncated: %r" % rel)
                    out.write(chunk)
                    remaining -= len(chunk)
        except OSError as exc:
            raise Rejected("entries conflict at %r: %s" % (rel, exc.strerror or exc))


def unpack(data, cfg, staging):
    try:
        tar = tarfile.open(fileobj=io.BytesIO(data), mode="r:gz")
    except (tarfile.TarError, OSError, EOFError, ValueError) as exc:
        raise Rejected("package is not a gzip tar archive: %s" % exc)
    with tar:
        try:
            entries, files, total = inspect_members(tar, cfg)
            extract_entries(tar, entries, staging)
        except (tarfile.TarError, EOFError) as exc:
            raise Rejected("package is malformed: %s" % exc)
    return entries, files, total


def check_required(staging, cfg):
    for rel in cfg["required_files"]:
        if not os.path.isfile(os.path.join(staging, *rel.split("/"))):
            raise Rejected("required file is missing: %r" % rel)


def check_htaccess(staging, cfg):
    with open(os.path.join(staging, ".htaccess"), "rb") as handle:
        candidate = handle.read()
    approved = []
    try:
        names = sorted(os.listdir(cfg["approved_dir"]))
    except OSError as exc:
        raise Rejected("cannot read the approved .htaccess directory: %s" % exc)
    for name in names:
        path = os.path.join(cfg["approved_dir"], name)
        if name.startswith(".") or not os.path.isfile(path) or os.path.islink(path):
            continue
        with open(path, "rb") as handle:
            approved.append(handle.read())
    if not approved:
        raise Rejected("no approved .htaccess exists on the host")
    if not any(candidate == copy for copy in approved):
        raise Rejected("the .htaccess does not match any approved copy")


# --------------------------------------------------------------------------- document root


def scan_live(root, preserve):
    """Return (files, dirs) of relative paths under the document root.

    Preserved names are skipped. A stale temporary file from an interrupted
    run is removed. Any link or special file is a reason to stop.
    """
    files = set()
    dirs = set()

    def walk(directory, prefix):
        with os.scandir(directory) as it:
            for entry in it:
                rel = prefix + entry.name
                if rel in preserve:
                    continue
                if entry.is_symlink():
                    raise Rejected("unexpected link in the document root: %r" % rel)
                if entry.is_dir(follow_symlinks=False):
                    dirs.add(rel)
                    walk(entry.path, rel + "/")
                elif entry.is_file(follow_symlinks=False):
                    if entry.name.startswith(TEMP_PREFIX):
                        os.unlink(entry.path)
                        continue
                    files.add(rel)
                else:
                    raise Rejected("unexpected object in the document root: %r" % rel)

    walk(root, "")
    return files, dirs


def open_regular(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    return os.fdopen(fd, "rb")


def install_file(source, dest):
    """Write dest atomically from source, world-readable, replacing any file."""
    directory = os.path.dirname(dest)
    tmp = os.path.join(directory, TEMP_PREFIX + secrets.token_hex(8))
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
    try:
        with os.fdopen(fd, "wb") as out, open_regular(source) as inp:
            shutil.copyfileobj(inp, out)
            out.flush()
            os.fsync(out.fileno())
        os.chmod(tmp, 0o644)
        os.replace(tmp, dest)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def take_snapshot(root, files, snapshots_dir, sha):
    name = "%s-%s-%s" % (time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()), sha[:8], secrets.token_hex(2))
    snapshot = os.path.join(snapshots_dir, name)
    os.mkdir(snapshot, 0o700)
    for rel in sorted(files):
        source = os.path.join(root, *rel.split("/"))
        dest = os.path.join(snapshot, *rel.split("/"))
        private_dir(os.path.dirname(dest))
        with open_regular(source) as inp:
            fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as out:
                shutil.copyfileobj(inp, out)
    return snapshot


def depth_first(paths):
    return sorted(paths, key=lambda rel: rel.count("/"), reverse=True)


def publish(staging, entries, root, live_files, live_dirs):
    staged_files = {rel for kind, rel, _ in entries if kind == "file"}
    staged_dirs = {rel for kind, rel, _ in entries if kind == "dir"}
    for rel in staged_files:
        parts = rel.split("/")
        for index in range(1, len(parts)):
            staged_dirs.add("/".join(parts[:index]))

    # A path that changes type between deploys is replaced first.
    for rel in staged_dirs & live_files:
        os.unlink(os.path.join(root, *rel.split("/")))
    for rel in staged_files & live_dirs:
        shutil.rmtree(os.path.join(root, *rel.split("/")))

    for rel in sorted(staged_dirs):
        public_dir(os.path.join(root, *rel.split("/")))

    entry_points = sorted(rel for rel in staged_files if rel.rsplit(".", 1)[-1] in ENTRY_POINT_SUFFIXES)
    assets = sorted(rel for rel in staged_files if rel not in set(entry_points))
    for rel in assets + entry_points:
        install_file(os.path.join(staging, *rel.split("/")), os.path.join(root, *rel.split("/")))

    for rel in sorted(live_files - staged_files):
        os.unlink(os.path.join(root, *rel.split("/")))
    for rel in depth_first(live_dirs - staged_dirs):
        try:
            os.rmdir(os.path.join(root, *rel.split("/")))
        except OSError:
            pass


def restore(snapshot, root, preserve):
    snapshot_files = set()
    for dirpath, _, filenames in os.walk(snapshot):
        for filename in filenames:
            full = os.path.join(dirpath, filename)
            rel = os.path.relpath(full, snapshot).replace(os.sep, "/")
            snapshot_files.add(rel)
            dest = os.path.join(root, *rel.split("/"))
            public_dir(os.path.dirname(dest))
            install_file(full, dest)
    live_files, live_dirs = scan_live(root, preserve)
    for rel in sorted(live_files - snapshot_files):
        os.unlink(os.path.join(root, *rel.split("/")))
    for rel in depth_first(live_dirs):
        try:
            os.rmdir(os.path.join(root, *rel.split("/")))
        except OSError:
            pass


def prune_snapshots(snapshots_dir, keep):
    names = sorted(
        name
        for name in os.listdir(snapshots_dir)
        if os.path.isdir(os.path.join(snapshots_dir, name)) and not os.path.islink(os.path.join(snapshots_dir, name))
    )
    for name in names[:-keep] if keep < len(names) else []:
        shutil.rmtree(os.path.join(snapshots_dir, name))


# --------------------------------------------------------------------------- live check


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def live_check(cfg, expected_index):
    origin = cfg["origin"]
    timeout = cfg["limits"]["http_timeout_seconds"]
    context = ssl.create_default_context()
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=context))

    def get(path):
        request = urllib.request.Request(
            origin + path,
            headers={
                "Accept-Encoding": "identity",
                "Cache-Control": "no-cache",
                "User-Agent": "cristianvega-deploy-receiver",
            },
        )
        try:
            with opener.open(request, timeout=timeout) as response:
                headers = {key.lower(): value for key, value in response.headers.items()}
                return response.status, headers, response.read(cfg["limits"]["file_bytes"] + 1)
        except urllib.error.HTTPError as exc:
            headers = {key.lower(): value for key, value in exc.headers.items()}
            return exc.code, headers, b""
        except (urllib.error.URLError, OSError, ValueError) as exc:
            raise Failed("live check could not fetch %s: %s" % (path, exc))

    status, headers, body = get("/")
    if status != 200:
        raise Failed("GET / returned HTTP %d" % status)
    if body != expected_index:
        raise Failed("the live homepage does not match the published index.html")
    missing = [name for name in REQUIRED_HEADERS if name not in headers]
    if missing:
        raise Failed("missing response headers: %s" % ", ".join(missing))
    match = re.search(r"(?:^|;\s*)max-age=(\d+)", headers["strict-transport-security"], re.I)
    if not match or int(match.group(1)) < MIN_HSTS_MAX_AGE:
        raise Failed("HSTS max-age is below %d" % MIN_HSTS_MAX_AGE)
    csp = headers["content-security-policy"]
    for directive in REQUIRED_CSP_DIRECTIVES:
        if directive not in csp:
            raise Failed("CSP is missing %s" % directive)
    probe = "/deploy-check-%s/" % secrets.token_hex(8)
    status, _, _ = get(probe)
    if status != 404:
        raise Failed("GET %s returned HTTP %d, expected 404" % (probe, status))


# --------------------------------------------------------------------------- main


def deploy(cfg):
    limits = cfg["limits"]
    state_dir = cfg["state_dir"]
    staging_root = os.path.join(state_dir, "staging")
    snapshots_dir = os.path.join(state_dir, "snapshots")
    for path in (state_dir, staging_root, snapshots_dir):
        private_dir(path)
    private_dir(cfg["approved_dir"])

    record = {
        "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "receiver": receiver_sha256(),
        "sha256": None,
        "files": None,
        "bytes": None,
        "result": None,
        "reason": None,
    }

    def finish(result, reason=None):
        record["result"] = result
        record["reason"] = reason
        append_log(state_dir, record)

    lock_fd = acquire_lock(os.path.join(state_dir, "deploy.lock"))
    staging = None
    try:
        data = read_package(limits["compressed_bytes"])
        sha = hashlib.sha256(data).hexdigest()
        record["sha256"] = sha

        staging = os.path.join(staging_root, "%d-%s" % (os.getpid(), secrets.token_hex(4)))
        os.mkdir(staging, 0o700)
        entries, files, total = unpack(data, cfg, staging)
        record["files"] = files
        record["bytes"] = total
        check_required(staging, cfg)
        check_htaccess(staging, cfg)
        with open(os.path.join(staging, "index.html"), "rb") as handle:
            expected_index = handle.read()

        live_files, live_dirs = scan_live(cfg["web_root"], cfg["preserve"])
        snapshot = take_snapshot(cfg["web_root"], live_files, snapshots_dir, sha)
        try:
            publish(staging, entries, cfg["web_root"], live_files, live_dirs)
            live_check(cfg, expected_index)
        except Exception as exc:  # any failure after the snapshot exists
            reason = str(exc) if isinstance(exc, Failed) else "%s: %s" % (type(exc).__name__, exc)
            try:
                restore(snapshot, cfg["web_root"], cfg["preserve"])
            except Exception as restore_exc:
                finish("failed", "%s; restore also failed: %s" % (reason, restore_exc))
                err("%s; restore also failed: %s" % (reason, restore_exc))
                return 1
            finish("restored", reason)
            err("%s; the previous site was restored" % reason)
            return 1
        prune_snapshots(snapshots_dir, cfg["snapshots_to_keep"])
        finish("ok")
        print("DEPLOY_OK %s %s" % (sha, record["receiver"]))
        sys.stdout.flush()
        return 0
    except Rejected as exc:
        finish("rejected", str(exc))
        err("rejected: %s" % exc)
        return 1
    finally:
        if staging is not None:
            shutil.rmtree(staging, ignore_errors=True)
        os.close(lock_fd)


def main(argv=None):
    parser = argparse.ArgumentParser(description="cristianvega.ai deployment receiver")
    parser.add_argument("--config", required=True, help="path to the private JSON configuration")
    args = parser.parse_args(argv)

    command = os.environ.get("SSH_ORIGINAL_COMMAND")
    os.environ.clear()
    os.umask(0o077)

    if command == "version":
        print("RECEIVER %s" % receiver_sha256())
        return 0
    if command != "deploy":
        err("rejected: unexpected command")
        return 1

    try:
        cfg = load_config(args.config)
    except ConfigError as exc:
        err("configuration error: %s" % exc)
        return 2
    set_limits(cfg["limits"])
    return deploy(cfg)


if __name__ == "__main__":
    sys.exit(main())
