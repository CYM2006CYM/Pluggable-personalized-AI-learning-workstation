import { spawnSync } from "node:child_process";

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

process.stdout.write(`node=${process.version}\n`);
run("cmd.exe", ["/d", "/s", "/c", "npm.cmd --version"]);
run("where.exe", ["python"]);
run("python", ["-c", "import sys,pandas,dateutil; print('executable='+sys.executable); print('python='+sys.version.split()[0]); print('pandas='+pandas.__version__); print('dateutil='+dateutil.__version__); print('no_user_site='+str(sys.flags.no_user_site))"]);
run("python", ["-c", "import sys; print('node_child_python='+sys.executable)"]);
