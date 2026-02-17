<?php
/**
 * Build firmware on demand and return a manifest pointing to a fresh binary.
 * GET /crispface/api/build_firmware.php?env=watchy|stock&watch_id=<id>
 *
 * When watch_id is provided, injects per-watch WiFi networks and watch ID
 * into config.h before building, then restores defaults after.
 */
header('Content-Type: application/json');
header('Cache-Control: no-store');

$env = $_GET['env'] ?? 'watchy';
if (!in_array($env, ['watchy', 'stock'], true)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Invalid env']);
    exit;
}

$firmwareDir = realpath(__DIR__ . '/../firmware');
$buildsDir   = realpath(__DIR__ . '/../firmware-builds');
$dataDir     = realpath(__DIR__ . '/../data');

if (!$firmwareDir || !$buildsDir) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Firmware directory not found']);
    exit;
}

$configPath = $firmwareDir . '/include/config.h';
$config = file_get_contents($configPath);

// Bump version (this persists across builds)
if ($config && preg_match('/#define\s+CRISPFACE_VERSION\s+"(\d+)\.(\d+)\.(\d+)"/', $config, $m)) {
    $newVer = $m[1] . '.' . $m[2] . '.' . ($m[3] + 1);
    $config = preg_replace(
        '/#define\s+CRISPFACE_VERSION\s+"[^"]+"/',
        '#define CRISPFACE_VERSION    "' . $newVer . '"',
        $config
    );
    file_put_contents($configPath, $config);
}

// Save the version-bumped config as the persistent state to restore after build
$persistentConfig = $config;

// Per-watch config injection (temporary — reverted after build)
$watchId = $_GET['watch_id'] ?? '';
if ($watchId && $env === 'watchy') {
    $safeId = preg_replace('/[^a-f0-9]/', '', $watchId);
    $watch = null;

    // Search for the watch file across all users
    if ($safeId && $dataDir) {
        $usersDir = $dataDir . '/users';
        if (is_dir($usersDir)) {
            foreach (scandir($usersDir) as $userDir) {
                if ($userDir === '.' || $userDir === '..') continue;
                $watchFile = $usersDir . '/' . $userDir . '/watches/' . $safeId . '.json';
                if (file_exists($watchFile)) {
                    $watch = json_decode(file_get_contents($watchFile), true);
                    $watchOwner = $userDir;
                    break;
                }
            }
        }
    }

    if ($watch) {
        // Inject watch ID
        $config = preg_replace(
            '/#define\s+CRISPFACE_WATCH_ID\s+"[^"]+"/',
            '#define CRISPFACE_WATCH_ID   "' . addcslashes($safeId, '"\\') . '"',
            $config
        );

        // Find the user's API token
        $usersFile = $dataDir . '/users.json';
        if (file_exists($usersFile) && isset($watchOwner)) {
            $users = json_decode(file_get_contents($usersFile), true) ?: [];
            foreach ($users as $u) {
                if (($u['username'] ?? '') === $watchOwner) {
                    $tokens = $u['api_tokens'] ?? [];
                    if (!empty($tokens)) {
                        $config = preg_replace(
                            '/#define\s+CRISPFACE_API_TOKEN\s+"[^"]+"/',
                            '#define CRISPFACE_API_TOKEN  "' . addcslashes($tokens[0], '"\\') . '"',
                            $config
                        );
                    }
                    break;
                }
            }
        }

        // Inject timezone GMT offset
        $tz = $watch['timezone'] ?? 'Europe/London';
        try {
            $dtz = new DateTimeZone($tz);
            $now = new DateTime('now', $dtz);
            $offsetSec = $dtz->getOffset($now);
            $offsetHours = $offsetSec / 3600;
        } catch (Exception $e) {
            $offsetHours = 0;
        }
        $config = preg_replace(
            '/#define\s+CRISPFACE_GMT_OFFSET\s+[^\n]+/',
            '#define CRISPFACE_GMT_OFFSET ' . $offsetHours,
            $config
        );

        // Inject build epoch (Unix timestamp) so firmware can seed RTC on first boot
        $config = preg_replace(
            '/#define\s+CRISPFACE_BUILD_EPOCH\s+\d+/',
            '#define CRISPFACE_BUILD_EPOCH ' . time(),
            $config
        );

        // Inject WiFi networks
        $networks = $watch['wifi_networks'] ?? [];
        if (!empty($networks)) {
            // Remove old single-network defines
            $config = preg_replace('/#define\s+CRISPFACE_WIFI_SSID\s+"[^"]*"\s*\n?/', '', $config);
            $config = preg_replace('/#define\s+CRISPFACE_WIFI_PASS\s+"[^"]*"\s*\n?/', '', $config);
            // Remove any existing multi-network defines
            $config = preg_replace('/#define\s+CRISPFACE_WIFI_COUNT\s+\d+\s*\n?/', '', $config);
            $config = preg_replace('/#define\s+CRISPFACE_WIFI_SSID_\d+\s+"[^"]*"\s*\n?/', '', $config);
            $config = preg_replace('/#define\s+CRISPFACE_WIFI_PASS_\d+\s+"[^"]*"\s*\n?/', '', $config);

            // Add multi-network defines before #endif
            $wifiDefs = "\n#define CRISPFACE_WIFI_COUNT " . count($networks) . "\n";
            for ($i = 0; $i < count($networks); $i++) {
                $ssid = addcslashes($networks[$i]['ssid'] ?? '', '"\\');
                $pass = addcslashes($networks[$i]['password'] ?? '', '"\\');
                $wifiDefs .= '#define CRISPFACE_WIFI_SSID_' . $i . ' "' . $ssid . '"' . "\n";
                $wifiDefs .= '#define CRISPFACE_WIFI_PASS_' . $i . ' "' . $pass . '"' . "\n";
            }
            $config = str_replace("\n#endif", $wifiDefs . "\n#endif", $config);
        }
    }
}

file_put_contents($configPath, $config);

// PlatformIO build — set PATH so toolchain binaries are found
$home = '/var/www/users/playground';
$path = implode(':', [
    $home . '/.platformio/penv/bin',
    $home . '/.local/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
]);
$pioPath = $home . '/.local/bin/pio';
$cmd = 'HOME=' . escapeshellarg($home)
     . ' PATH=' . escapeshellarg($path)
     . ' ' . escapeshellcmd($pioPath)
     . ' run -e ' . escapeshellarg($env) . ' 2>&1';
$buildOutput = '';
$exitCode = 0;
exec('cd ' . escapeshellarg($firmwareDir) . ' && ' . $cmd, $outputLines, $exitCode);
$buildOutput = implode("\n", $outputLines);

// Restore persistent config (version-bumped but without per-watch WiFi injection)
file_put_contents($configPath, $persistentConfig);

if ($exitCode !== 0) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => 'Build failed',
        'output' => $buildOutput
    ]);
    exit;
}

// Merge binary with esptool
$timestamp = time();
$prefix = ($env === 'watchy') ? 'crispface' : 'stock';
$binName = $prefix . '-' . $timestamp . '.bin';
$binPath = $buildsDir . '/' . $binName;

$bootApp0 = '/var/www/users/playground/.platformio/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin';
$buildDir = $firmwareDir . '/.pio/build/' . $env;

$mergeCmd = 'HOME=' . escapeshellarg($home)
    . ' PATH=' . escapeshellarg($path)
    . ' python3 -m esptool --chip esp32s3 merge-bin'
    . ' -o ' . escapeshellarg($binPath)
    . ' --flash-mode dio --flash-size 8MB'
    . ' 0x0 '     . escapeshellarg($buildDir . '/bootloader.bin')
    . ' 0x8000 '  . escapeshellarg($buildDir . '/partitions.bin')
    . ' 0xe000 '  . escapeshellarg($bootApp0)
    . ' 0x10000 ' . escapeshellarg($buildDir . '/firmware.bin')
    . ' 2>&1';

$mergeOutput = '';
exec($mergeCmd, $mergeLines, $mergeExit);
$mergeOutput = implode("\n", $mergeLines);

if ($mergeExit !== 0 || !file_exists($binPath)) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => 'Merge failed',
        'output' => $mergeOutput
    ]);
    exit;
}

// Write a manifest pointing to the fresh binary
$manifestName = $prefix . '-' . $timestamp . '.manifest.json';
$manifestPath = $buildsDir . '/' . $manifestName;
$name = ($env === 'watchy') ? 'CrispFace' : 'Watchy Stock';

$manifest = [
    'name' => $name,
    'version' => $timestamp,
    'builds' => [
        [
            'chipFamily' => 'ESP32-S3',
            'parts' => [
                ['path' => $binName, 'offset' => 0]
            ]
        ]
    ]
];

file_put_contents($manifestPath, json_encode($manifest, JSON_PRETTY_PRINT));

// Clean up old timestamped builds (keep last 3)
$pattern = $buildsDir . '/' . $prefix . '-*.bin';
$oldBins = glob($pattern);
if ($oldBins) {
    sort($oldBins);
    while (count($oldBins) > 3) {
        $old = array_shift($oldBins);
        @unlink($old);
        // Also remove its manifest
        @unlink(str_replace('.bin', '.manifest.json', $old));
    }
}

echo json_encode([
    'success' => true,
    'manifest' => 'firmware-builds/' . $manifestName,
    'binary' => $binName,
    'size' => filesize($binPath),
    'version' => $newVer ?? 'unknown',
]);
