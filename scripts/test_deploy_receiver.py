#!/usr/bin/env python3
"""Tests for scripts/deploy-receiver.py.

Run with `npm run test:receiver` or `python3 scripts/test_deploy_receiver.py`.

Most tests run the receiver as a subprocess, the way the SSH forced command
runs it: SSH_ORIGINAL_COMMAND in the environment, the package on standard
input. A small HTTP server stands in for Apache and serves the test document
root with the production security headers, so the receiver's live check and
its restore path run for real.
"""

import fcntl
import gzip
import hashlib
import http.server
import importlib.util
import io
import json
import os
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
RECEIVER = os.path.join(HERE, "deploy-receiver.py")
DIST = os.path.join(os.path.dirname(HERE), "dist")

HTACCESS = b"# test policy\nHeader always set X-Test \"1\"\n"
OTHER_HTACCESS = b"# a second approved policy\n"

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Strict-Transport-Security": "max-age=31536000",
    "Content-Security-Policy": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'",
}

ALLOWED_SUFFIXES = ["html", "css", "js", "jpg", "png", "svg", "txt", "xml", "woff2"]
REQUIRED_FILES = [".htaccess", "index.html", "404.html", "robots.txt", "sitemap-index.xml"]


def load_receiver_module():
    spec = importlib.util.spec_from_file_location("deploy_receiver", RECEIVER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def receiver_sha256():
    with open(RECEIVER, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


# --------------------------------------------------------------------------- fixtures


def site_files(version="v1", htaccess=HTACCESS):
    return {
        ".htaccess": htaccess,
        "index.html": ("<!doctype html><h1>site %s</h1>\n" % version).encode(),
        "404.html": b"<!doctype html><h1>not found</h1>\n",
        "robots.txt": b"User-agent: *\nAllow: /\n",
        "sitemap-index.xml": b"<sitemapindex></sitemapindex>\n",
        "_astro/app.abc123.css": b"body{margin:0}\n",
        "images/pic.png": b"\x89PNG\r\n\x1a\n",
        "posts/one/index.html": b"<!doctype html><h1>one</h1>\n",
    }


def write_tree(root, files):
    if os.path.isdir(root):
        shutil.rmtree(root)
    os.makedirs(root, 0o755)
    for rel, data in files.items():
        path = os.path.join(root, *rel.split("/"))
        os.makedirs(os.path.dirname(path), 0o755, exist_ok=True)
        with open(path, "wb") as handle:
            handle.write(data)
        os.chmod(path, 0o644)
    for dirpath, dirnames, _ in os.walk(root):
        for name in dirnames:
            os.chmod(os.path.join(dirpath, name), 0o755)


def read_tree(root, skip=(".dh-diag",)):
    tree = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [name for name in dirnames if name not in skip]
        for name in filenames:
            if name in skip:
                continue
            full = os.path.join(dirpath, name)
            if os.path.islink(full):
                continue
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            with open(full, "rb") as handle:
                tree[rel] = handle.read()
    return tree


def _plain_owner(info):
    info.uid = info.gid = 0
    info.uname = info.gname = ""
    info.mtime = 0
    return info


def pack(root, mutate=None):
    """Pack a directory the way the workflow does: `tar --format=ustar -C root .`."""
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz", format=tarfile.USTAR_FORMAT) as tar:
        tar.add(root, arcname=".", filter=_plain_owner)
        if mutate is not None:
            mutate(tar)
    return buffer.getvalue()


def add_file(tar, name, data=b"x", mode=0o644):
    info = tarfile.TarInfo(name)
    info.size = len(data)
    info.mode = mode
    info.mtime = 0
    tar.addfile(info, io.BytesIO(data))


def add_special(tar, name, kind, linkname=""):
    info = tarfile.TarInfo(name)
    info.type = kind
    info.linkname = linkname
    info.mode = 0o644
    info.mtime = 0
    tar.addfile(info)


class SiteHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        server = self.server
        path = self.path.split("?", 1)[0]
        if path.endswith("/"):
            path += "index.html"
        rel = path.lstrip("/")
        full = os.path.normpath(os.path.join(server.root, rel))
        inside = full.startswith(server.root + os.sep)
        if not inside or not os.path.isfile(full):
            body = b"<h1>not found</h1>"
            not_found = os.path.join(server.root, "404.html")
            if os.path.isfile(not_found):
                with open(not_found, "rb") as handle:
                    body = handle.read()
            self._send(404, body, server.headers)
            return
        with open(full, "rb") as handle:
            body = handle.read()
        if server.override_index is not None and rel == "index.html":
            body = server.override_index
        self._send(200, body, server.headers)

    def _send(self, status, body, headers):
        self.send_response(status)
        for key, value in headers.items():
            self.send_header(key, value)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class SiteServer:
    """Serves a document root with the production headers, on a free port."""

    def __init__(self, root):
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), SiteHandler)
        self.server.root = os.path.realpath(root)
        self.server.headers = dict(SECURITY_HEADERS)
        self.server.override_index = None
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    @property
    def origin(self):
        return "http://127.0.0.1:%d" % self.server.server_address[1]

    def drop_header(self, name):
        del self.server.headers[name]

    def override_index(self, body):
        self.server.override_index = body

    def stop(self):
        self.server.shutdown()
        self.server.server_close()


# --------------------------------------------------------------------------- base case


class ReceiverCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="deploy-receiver-test-")
        self.src = os.path.join(self.tmp, "src")
        self.web = os.path.join(self.tmp, "web")
        self.state = os.path.join(self.tmp, "state")
        self.approved = os.path.join(self.tmp, "approved")
        write_tree(self.src, site_files("v1"))
        os.makedirs(self.web, 0o755)
        os.makedirs(self.approved, 0o700)
        self.approve(HTACCESS, "2026-08.htaccess")
        self.server = SiteServer(self.web)
        self.config_path = os.path.join(self.tmp, "config.json")
        self.write_config()

    def tearDown(self):
        self.server.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def approve(self, content, name):
        with open(os.path.join(self.approved, name), "wb") as handle:
            handle.write(content)

    def config(self, **overrides):
        limits = {
            "compressed_bytes": 5 * 1024 * 1024,
            "expanded_bytes": 20 * 1024 * 1024,
            "file_bytes": 5 * 1024 * 1024,
            "members": 500,
            "path_bytes": 1024,
            "component_bytes": 255,
            "cpu_seconds": 30,
            "memory_bytes": 1024 * 1024 * 1024,
            "http_timeout_seconds": 5,
        }
        limits.update(overrides.pop("limits", {}))
        data = {
            "web_root": self.web,
            "state_dir": self.state,
            "approved_dir": self.approved,
            "origin": self.server.origin,
            "require_tls": False,
            "preserve": [".dh-diag"],
            "allowed_suffixes": ALLOWED_SUFFIXES,
            "required_files": REQUIRED_FILES,
            "snapshots_to_keep": 3,
            "limits": limits,
        }
        data.update(overrides)
        return data

    def write_config(self, **overrides):
        with open(self.config_path, "w", encoding="utf-8") as handle:
            json.dump(self.config(**overrides), handle)

    def run_receiver(self, package, command="deploy", config=None):
        env = {"PATH": os.environ.get("PATH", "")}
        if command is not None:
            env["SSH_ORIGINAL_COMMAND"] = command
        return subprocess.run(
            [sys.executable, RECEIVER, "--config", config or self.config_path],
            input=package,
            capture_output=True,
            env=env,
            timeout=120,
        )

    def deploy(self, package=None, command="deploy"):
        if package is None:
            package = pack(self.src)
        return self.run_receiver(package, command)

    def assert_rejected(self, result, message):
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(result.stdout, b"")
        self.assertIn(message.encode(), result.stderr)

    def log_records(self):
        path = os.path.join(self.state, "deploy.log")
        if not os.path.exists(path):
            return []
        with open(path, "r", encoding="utf-8") as handle:
            return [json.loads(line) for line in handle if line.strip()]

    def snapshots(self):
        path = os.path.join(self.state, "snapshots")
        return sorted(os.listdir(path)) if os.path.isdir(path) else []


# --------------------------------------------------------------------------- publishing


class PublishTests(ReceiverCase):
    def test_publishes_a_valid_package(self):
        package = pack(self.src)
        result = self.deploy(package)
        self.assertEqual(result.returncode, 0, result.stderr)
        sha = hashlib.sha256(package).hexdigest()
        self.assertEqual(result.stdout, ("DEPLOY_OK %s %s\n" % (sha, receiver_sha256())).encode())
        self.assertEqual(result.stderr, b"")
        self.assertEqual(read_tree(self.web), site_files("v1"))

        for dirpath, dirnames, filenames in os.walk(self.web):
            for name in filenames:
                mode = stat.S_IMODE(os.stat(os.path.join(dirpath, name)).st_mode)
                self.assertEqual(mode, 0o644, name)
            for name in dirnames:
                mode = stat.S_IMODE(os.stat(os.path.join(dirpath, name)).st_mode)
                self.assertEqual(mode, 0o755, name)

        record = self.log_records()[-1]
        self.assertEqual(record["result"], "ok")
        self.assertEqual(record["sha256"], sha)
        self.assertEqual(record["files"], len(site_files()))
        self.assertEqual(record["bytes"], sum(len(data) for data in site_files().values()))
        self.assertEqual(record["receiver"], receiver_sha256())
        self.assertEqual(len(self.snapshots()), 1)
        self.assertEqual(os.listdir(os.path.join(self.state, "staging")), [])

    def test_second_deploy_replaces_files_and_removes_stale_ones(self):
        self.assertEqual(self.deploy().returncode, 0)
        v2 = site_files("v2")
        del v2["_astro/app.abc123.css"]
        del v2["posts/one/index.html"]
        v2["_astro/app.def456.css"] = b"body{margin:1px}\n"
        v2["posts/two/index.html"] = b"<!doctype html><h1>two</h1>\n"
        write_tree(self.src, v2)

        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(read_tree(self.web), v2)
        self.assertFalse(os.path.exists(os.path.join(self.web, "posts", "one")))
        self.assertEqual(len(self.snapshots()), 2)

    def test_publishes_the_real_build_when_present(self):
        if not os.path.isfile(os.path.join(DIST, "index.html")):
            self.skipTest("dist/ is not built")
        with open(os.path.join(DIST, ".htaccess"), "rb") as handle:
            self.approve(handle.read(), "dist.htaccess")
        result = self.deploy(pack(DIST))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(read_tree(self.web), read_tree(DIST))

    def test_version_command_reports_the_receiver_hash_and_changes_nothing(self):
        result = self.deploy(b"", command="version")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, ("RECEIVER %s\n" % receiver_sha256()).encode())
        self.assertEqual(os.listdir(self.web), [])
        self.assertFalse(os.path.exists(self.state))

    def test_preserves_dh_diag_and_removes_a_stale_temporary_file(self):
        os.symlink("/nonexistent/dh-diag-target", os.path.join(self.web, ".dh-diag"))
        stale = os.path.join(self.web, ".deploy-tmp-deadbeef")
        with open(stale, "wb") as handle:
            handle.write(b"left behind")
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(os.path.islink(os.path.join(self.web, ".dh-diag")))
        self.assertFalse(os.path.exists(stale))
        self.assertEqual(read_tree(self.web), site_files("v1"))
        snapshot = os.path.join(self.state, "snapshots", self.snapshots()[0])
        self.assertFalse(os.path.lexists(os.path.join(snapshot, ".dh-diag")))

    def test_keeps_only_the_three_newest_snapshots(self):
        for version in ("v1", "v2", "v3", "v4", "v5"):
            write_tree(self.src, site_files(version))
            self.assertEqual(self.deploy().returncode, 0)
        self.assertEqual(len(self.snapshots()), 3)

    def test_accepts_any_approved_htaccess(self):
        self.approve(OTHER_HTACCESS, "2026-09.htaccess")
        write_tree(self.src, site_files("v1", htaccess=OTHER_HTACCESS))
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(read_tree(self.web)[".htaccess"], OTHER_HTACCESS)


# --------------------------------------------------------------------------- restore


class RestoreTests(ReceiverCase):
    def test_restores_the_previous_site_when_a_header_is_missing(self):
        self.assertEqual(self.deploy().returncode, 0)
        v2 = site_files("v2")
        del v2["posts/one/index.html"]
        v2["posts/two/index.html"] = b"<!doctype html><h1>two</h1>\n"
        write_tree(self.src, v2)
        self.server.drop_header("Strict-Transport-Security")

        result = self.deploy()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, b"")
        self.assertIn(b"missing response headers: strict-transport-security", result.stderr)
        self.assertIn(b"the previous site was restored", result.stderr)
        self.assertEqual(read_tree(self.web), site_files("v1"))
        self.assertFalse(os.path.exists(os.path.join(self.web, "posts", "two")))
        record = self.log_records()[-1]
        self.assertEqual(record["result"], "restored")
        self.assertIn("strict-transport-security", record["reason"])

    def test_restores_when_the_live_homepage_does_not_match(self):
        self.assertEqual(self.deploy().returncode, 0)
        write_tree(self.src, site_files("v2"))
        self.server.override_index(b"<h1>a cache in front is serving old bytes</h1>")
        result = self.deploy()
        self.assertEqual(result.returncode, 1)
        self.assertIn(b"does not match the published index.html", result.stderr)
        self.assertEqual(read_tree(self.web), site_files("v1"))

    def test_restores_when_a_missing_path_is_not_a_404(self):
        self.assertEqual(self.deploy().returncode, 0)
        write_tree(self.src, site_files("v2"))
        original = SiteHandler.do_GET

        def soft_404(handler):
            handler.path = "/"
            original(handler)

        SiteHandler.do_GET = soft_404
        try:
            result = self.deploy()
        finally:
            SiteHandler.do_GET = original
        self.assertEqual(result.returncode, 1)
        self.assertIn(b"expected 404", result.stderr)
        self.assertEqual(read_tree(self.web), site_files("v1"))


# --------------------------------------------------------------------------- rejects


class RejectTests(ReceiverCase):
    def assert_web_untouched(self):
        self.assertEqual(os.listdir(self.web), [])

    def test_rejects_an_unexpected_command(self):
        for command in ("ls", "deploy; id", "rsync --server", "", None):
            result = self.deploy(command=command)
            self.assert_rejected(result, "unexpected command")
        self.assert_web_untouched()

    def test_rejects_a_missing_required_file(self):
        for missing in REQUIRED_FILES:
            files = site_files()
            del files[missing]
            write_tree(self.src, files)
            self.assert_rejected(self.deploy(), "required file is missing: %r" % missing)
        self.assert_web_untouched()

    def test_rejects_an_unapproved_htaccess(self):
        write_tree(self.src, site_files(htaccess=HTACCESS + b"Options +ExecCGI\n"))
        self.assert_rejected(self.deploy(), "does not match any approved copy")
        self.assert_web_untouched()
        self.assertEqual(self.log_records()[-1]["result"], "rejected")

    def test_rejects_when_nothing_is_approved(self):
        os.unlink(os.path.join(self.approved, "2026-08.htaccess"))
        self.assert_rejected(self.deploy(), "no approved .htaccess exists")
        self.assert_web_untouched()

    def test_rejects_a_nested_htaccess_and_hidden_names(self):
        for name in ("./posts/.htaccess", "./.user.ini", "./.well-known/x.txt", "./_astro/.hidden.css"):
            package = pack(self.src, lambda tar, name=name: add_file(tar, name, b"x"))
            self.assert_rejected(self.deploy(package), "hidden name is not allowed")
        self.assert_web_untouched()

    def test_rejects_absolute_paths_and_traversal(self):
        cases = {
            "/etc/x.html": "absolute path",
            "../x.html": "bad path component",
            "./a/../x.html": "bad path component",
            "./a//x.html": "bad path component",
        }
        for name, message in cases.items():
            package = pack(self.src, lambda tar, name=name: add_file(tar, name, b"x"))
            self.assert_rejected(self.deploy(package), message)
        self.assert_web_untouched()

    def test_rejects_links_and_special_files(self):
        cases = [
            ("./link.html", tarfile.SYMTYPE, "index.html"),
            ("./escape.html", tarfile.SYMTYPE, "/etc/passwd"),
            ("./hard.html", tarfile.LNKTYPE, "./index.html"),
            ("./pipe.html", tarfile.FIFOTYPE, ""),
            ("./dev.html", tarfile.CHRTYPE, ""),
        ]
        for name, kind, linkname in cases:
            package = pack(self.src, lambda tar, n=name, k=kind, l=linkname: add_special(tar, n, k, l))
            self.assert_rejected(self.deploy(package), "not a plain file or directory")
        self.assert_web_untouched()

    def test_rejects_duplicate_and_case_folded_paths(self):
        package = pack(self.src, lambda tar: add_file(tar, "./index.html", b"again"))
        self.assert_rejected(self.deploy(package), "duplicate path")
        package = pack(self.src, lambda tar: add_file(tar, "./INDEX.html", b"again"))
        self.assert_rejected(self.deploy(package), "differs only by case")
        self.assert_web_untouched()

    def test_rejects_server_side_code_and_unknown_suffixes(self):
        cases = {
            "./evil.php": "suffix is not allowed",
            "./x.PHP": "suffix is not allowed",
            "./x.HTML": "suffix is not allowed",
            "./upload.cgi": "suffix is not allowed",
            "./noext": "file has no suffix",
            "./payload.php.jpg": "forbidden suffix component",
            "./a.cgi.png": "forbidden suffix component",
            "./page.shtml.html": "forbidden suffix component",
            "./settings.ini.txt": "forbidden suffix component",
            "./extra.json": "suffix is not allowed",
        }
        for name, message in cases.items():
            package = pack(self.src, lambda tar, name=name: add_file(tar, name, b"x"))
            self.assert_rejected(self.deploy(package), message)
        self.assert_web_untouched()

    def test_rejects_executable_and_special_mode_bits(self):
        for mode in (0o755, 0o744, 0o4644, 0o2644, 0o1644):
            package = pack(self.src, lambda tar, mode=mode: add_file(tar, "./run.html", b"x", mode=mode))
            self.assert_rejected(self.deploy(package), "executable or special mode bits")
        self.assert_web_untouched()

    def test_rejects_odd_bytes_in_names(self):
        for name in ("./café.html", "./a\tb.html", "./a\\b.html", "./nl\nx.html"):
            package = pack(self.src, lambda tar, name=name: add_file(tar, name, b"x"))
            result = self.deploy(package)
            self.assertEqual(result.returncode, 1, name)
            self.assertTrue(
                b"backslash" in result.stderr or b"control or non-ASCII" in result.stderr,
                result.stderr,
            )
        self.assert_web_untouched()

    def test_rejects_too_many_entries(self):
        self.write_config(limits={"members": 10})
        self.assert_rejected(self.deploy(), "more than 10 entries")
        self.assert_web_untouched()

    def test_rejects_an_oversized_package(self):
        self.write_config(limits={"compressed_bytes": 2048})
        package = pack(self.src, lambda tar: add_file(tar, "./big.txt", os.urandom(4096)))
        self.assert_rejected(self.deploy(package), "package exceeds 2048 bytes")
        self.assert_web_untouched()

    def test_rejects_a_package_that_expands_too_far(self):
        self.write_config(limits={"expanded_bytes": 3000, "file_bytes": 2000})
        package = pack(self.src, lambda tar: [add_file(tar, "./a.txt", b"a" * 1500), add_file(tar, "./b.txt", b"b" * 1500)])
        self.assert_rejected(self.deploy(package), "expands beyond 3000 bytes")
        self.assert_web_untouched()

    def test_rejects_a_single_file_over_the_limit(self):
        self.write_config(limits={"expanded_bytes": 100000, "file_bytes": 2000})
        package = pack(self.src, lambda tar: add_file(tar, "./a.txt", b"a" * 2001))
        self.assert_rejected(self.deploy(package), "larger than 2000 bytes")
        self.assert_web_untouched()

    def test_rejects_garbage_and_empty_input(self):
        self.assert_rejected(self.deploy(b"this is not a package"), "not a gzip tar archive")
        self.assert_rejected(self.deploy(b""), "package is empty")
        self.assert_web_untouched()

    def test_rejects_a_truncated_archive(self):
        raw = gzip.decompress(pack(self.src))
        package = gzip.compress(raw[: len(raw) // 2])
        result = self.deploy(package)
        self.assertEqual(result.returncode, 1)
        self.assertIn(b"rejected", result.stderr)
        self.assert_web_untouched()

    def test_rejects_when_the_document_root_holds_a_link_or_special_file(self):
        os.symlink("/etc", os.path.join(self.web, "etc"))
        self.assert_rejected(self.deploy(), "unexpected link in the document root")
        os.unlink(os.path.join(self.web, "etc"))
        os.mkfifo(os.path.join(self.web, "pipe"))
        self.assert_rejected(self.deploy(), "unexpected object in the document root")
        self.assertEqual(os.listdir(self.web), ["pipe"])
        self.assertEqual(self.snapshots(), [])

    def test_rejects_a_second_deploy_while_one_is_running(self):
        package = pack(self.src)
        env = {"PATH": os.environ.get("PATH", ""), "SSH_ORIGINAL_COMMAND": "deploy"}
        first = subprocess.Popen(
            [sys.executable, RECEIVER, "--config", self.config_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
        )
        try:
            lock_path = os.path.join(self.state, "deploy.lock")
            deadline = time.time() + 20
            held = False
            while time.time() < deadline and not held:
                if os.path.exists(lock_path):
                    fd = os.open(lock_path, os.O_RDWR)
                    try:
                        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        fcntl.flock(fd, fcntl.LOCK_UN)
                    except OSError:
                        held = True
                    finally:
                        os.close(fd)
                if not held:
                    time.sleep(0.05)
            self.assertTrue(held, "the first receiver never took the lock")

            second = self.deploy(package)
            self.assert_rejected(second, "another deploy is running")

            out, errors = first.communicate(package, timeout=120)
        finally:
            if first.poll() is None:
                first.kill()
        self.assertEqual(first.returncode, 0, errors)
        self.assertTrue(out.startswith(b"DEPLOY_OK "))
        self.assertEqual(read_tree(self.web), site_files("v1"))


# --------------------------------------------------------------------------- configuration


class ConfigTests(ReceiverCase):
    def assert_config_error(self, message, **overrides):
        path = os.path.join(self.tmp, "bad.json")
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(self.config(**overrides), handle)
        result = self.run_receiver(pack(self.src), config=path)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn(message.encode(), result.stderr)
        self.assertEqual(os.listdir(self.web), [])

    def test_refuses_a_state_dir_inside_the_web_root(self):
        self.assert_config_error("must not overlap web_root", state_dir=os.path.join(self.web, "state"))

    def test_refuses_plain_http_when_tls_is_required(self):
        self.assert_config_error("must use https", require_tls=True)

    def test_refuses_an_origin_with_a_path(self):
        self.assert_config_error("scheme and host", origin="https://cristianvega.ai/site")

    def test_refuses_a_forbidden_suffix_in_the_allowlist(self):
        self.assert_config_error("forbidden suffix", allowed_suffixes=ALLOWED_SUFFIXES + ["php"])

    def test_refuses_missing_limits(self):
        path = os.path.join(self.tmp, "bad.json")
        data = self.config()
        del data["limits"]["members"]
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(data, handle)
        result = self.run_receiver(pack(self.src), config=path)
        self.assertEqual(result.returncode, 2)
        self.assertIn(b"limits.members", result.stderr)

    def test_refuses_an_unreadable_config(self):
        result = self.run_receiver(pack(self.src), config=os.path.join(self.tmp, "missing.json"))
        self.assertEqual(result.returncode, 2)
        self.assertIn(b"cannot read", result.stderr)


# --------------------------------------------------------------------------- units


class NameRuleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = load_receiver_module()
        cls.limits = {"path_bytes": 64, "component_bytes": 16}
        cls.cfg = {"allowed_suffixes": frozenset(ALLOWED_SUFFIXES)}

    def test_normalizes_tar_names(self):
        normalize = self.mod.normalize_name
        self.assertEqual(normalize("./index.html", self.limits), "index.html")
        self.assertEqual(normalize("index.html", self.limits), "index.html")
        self.assertEqual(normalize("./posts/one/", self.limits), "posts/one")
        self.assertEqual(normalize("./", self.limits), "")
        self.assertEqual(normalize(".", self.limits), "")

    def test_rejects_bad_names(self):
        normalize = self.mod.normalize_name
        Rejected = self.mod.Rejected
        for name in ("/x", "../x", "a/../b", "a//b", "a/./b", "a\\b", "a\x01b", "café", "x" * 65, "a/" + "y" * 17):
            with self.assertRaises(Rejected, msg=name):
                normalize(name, self.limits)

    def test_filename_policy(self):
        check = self.mod.check_filename
        Rejected = self.mod.Rejected
        for ok in (".htaccess", "index.html", "_astro/a.b1.css", "fonts/x-400.abc.woff2", "images/a.b.c.png"):
            check(ok, self.cfg)
        for bad in ("evil.php", "x.PHP", "noext", "a.php.jpg", "a.cgi.png", "a.py.txt", "a.inc.js", "a.htaccess.html"):
            with self.assertRaises(Rejected, msg=bad):
                check(bad, self.cfg)

    def test_hidden_component_rule(self):
        check = self.mod.check_components
        Rejected = self.mod.Rejected
        check(".htaccess")
        check("posts/one/index.html")
        for bad in ("posts/.htaccess", ".user.ini", ".well-known/x.txt", "a/.b/c.html"):
            with self.assertRaises(Rejected, msg=bad):
                check(bad)


if __name__ == "__main__":
    unittest.main(verbosity=1)
