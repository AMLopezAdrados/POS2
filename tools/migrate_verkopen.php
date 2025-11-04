<?php
// tools/migrate_verkopen.php – normaliseer verkoopdata naar sessions-structuur met veilige backup

$baseDir = realpath(__DIR__ . '/..');
$srcDirs = [$baseDir . '/api/verkopen'];
if (is_dir($baseDir . '/api/api/verkopen')) $srcDirs[] = $baseDir . '/api/api/verkopen';
$legacyDir = $baseDir . '/api/legacy';
$unclassifiedDir = $legacyDir . '/unclassified';
@mkdir($legacyDir, 0775, true);
@mkdir($unclassifiedDir, 0775, true);

$cli = php_sapi_name() === 'cli';
if ($cli) {
  $opts = getopt('', ['migrate', 'purgeLegacy']);
  $doMigrate = isset($opts['migrate']);
  $purge = isset($opts['purgeLegacy']);
} else {
  $doMigrate = isset($_GET['migrate']);
  $purge = isset($_GET['purgeLegacy']);
}
$mode = $doMigrate ? 'migrate' : 'audit';

// Backup
$stamp = date('Ymd_His');
$backupFile = "$legacyDir/verkopen_backup_{$stamp}.zip";
$zip = new ZipArchive();
if ($zip->open($backupFile, ZipArchive::CREATE) === true) {
  foreach ($srcDirs as $src) {
    if (!is_dir($src)) continue;
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($src, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $file) {
      if ($file->isDir()) continue;
      $rel = substr($file->getPathname(), strlen($src) + 1);
      $zip->addFile($file->getPathname(), $rel);
    }
  }
  $zip->close();
}

$report = [
  'mode' => $mode,
  'backup' => $backupFile,
  'moved' => 0,
  'skipped' => 0,
  'legacy' => 0,
  'purged' => 0
];

function determineEventName($path, $data) {
  if (!empty($data['eventName'])) return $data['eventName'];
  $parent = basename(dirname($path));
  if ($parent !== 'verkopen' && $parent !== 'api') return $parent;
  $name = preg_split('/[_-]/', basename($path, '.json'))[0] ?? null;
  return $name ?: null;
}

foreach ($srcDirs as $root) {
  if (!is_dir($root)) continue;
  $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
  foreach ($it as $file) {
    if ($file->isDir()) continue;
    if (strtolower($file->getExtension()) !== 'json') continue;
    $path = $file->getPathname();
    if (strpos($path, '/sessions/') !== false) { $report['skipped']++; continue; }
    $data = json_decode(file_get_contents($path), true);
    $eventName = determineEventName($path, $data ?: []);
    if (!$eventName) {
      $dest = $unclassifiedDir . '/' . basename($path);
      if ($doMigrate) copy($path, $dest);
      $report['legacy']++;
      continue;
    }
    $sessionId = $data['sessionId'] ?? $data['sessieId'] ?? basename($path, '.json');
    $targetDir = $baseDir . '/api/verkopen/' . $eventName . '/sessions';
    $target = $targetDir . '/' . $sessionId . '.json';
    if ($doMigrate) {
      if (!is_dir($targetDir)) mkdir($targetDir, 0775, true);
      rename($path, $target);
      $indexFile = $targetDir . '/index.json';
      $index = file_exists($indexFile) ? json_decode(file_get_contents($indexFile), true) : ['files' => []];
      if (!in_array($sessionId . '.json', $index['files'])) {
        $index['files'][] = $sessionId . '.json';
        file_put_contents($indexFile, json_encode($index, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
      }
    }
    $report['moved']++;
  }
}

if ($doMigrate && $purge) {
  $purged = 0;
  foreach ($srcDirs as $root) {
    if (!is_dir($root)) continue;
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $file) {
      if ($file->isDir()) continue;
      $path = $file->getPathname();
      if (strpos($path, '/sessions/') !== false) continue;
      $dest = $legacyDir . '/' . basename($path);
      rename($path, $dest);
      $purged++;
    }
  }
  $report['purged'] = $purged;
}

header('Content-Type: application/json');
echo json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
