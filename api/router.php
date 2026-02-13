<?php
/**
 * Thin PHP proxy that executes Python CGI scripts.
 * Routes /api/*.py requests to the actual Python scripts,
 * forwarding environment variables and stdin, then
 * relaying the CGI output (headers + body) back to the client.
 */

$script = $_GET['__script'] ?? '';

// Allow sources/ subdirectory or top-level scripts
if (preg_match('#^sources/([a-z0-9_]+\.py)$#', $script, $m)) {
    // Source script in subdirectory
    $scriptPath = __DIR__ . '/sources/' . $m[1];
    $scriptName = 'sources/' . $m[1];
} elseif (preg_match('/^[a-z0-9_]+\.py$/', basename($script))) {
    $script = basename($script);
    $scriptPath = __DIR__ . '/' . $script;
    $scriptName = $script;
} else {
    http_response_code(404);
    header('Content-Type: application/json');
    echo json_encode(['success' => false, 'error' => 'Not found']);
    exit;
}
if (!file_exists($scriptPath)) {
    http_response_code(404);
    header('Content-Type: application/json');
    echo json_encode(['success' => false, 'error' => 'Not found']);
    exit;
}

// Build environment for the CGI script
$env = [
    'REQUEST_METHOD' => $_SERVER['REQUEST_METHOD'],
    'QUERY_STRING' => $_SERVER['QUERY_STRING'] ?? '',
    'CONTENT_TYPE' => $_SERVER['CONTENT_TYPE'] ?? '',
    'CONTENT_LENGTH' => $_SERVER['CONTENT_LENGTH'] ?? '',
    'HTTP_COOKIE' => $_SERVER['HTTP_COOKIE'] ?? '',
    'SERVER_NAME' => $_SERVER['SERVER_NAME'] ?? '',
    'SERVER_PORT' => $_SERVER['SERVER_PORT'] ?? '',
    'SCRIPT_NAME' => '/crispface/api/' . $scriptName,
    'PATH_INFO' => '',
    'PATH' => '/usr/local/bin:/usr/bin:/bin',
    'HOME' => '/tmp',
];

// Strip __script from QUERY_STRING
$qs = $_SERVER['QUERY_STRING'] ?? '';
$qs = preg_replace('/(?:^|&)__script=[^&]*/', '', $qs);
$qs = ltrim($qs, '&');
$env['QUERY_STRING'] = $qs;

// Read stdin (POST body)
$stdin = file_get_contents('php://input');

// Execute the Python script
$descriptors = [
    0 => ['pipe', 'r'],  // stdin
    1 => ['pipe', 'w'],  // stdout
    2 => ['pipe', 'w'],  // stderr
];

$process = proc_open(
    ['/usr/bin/python3', $scriptPath],
    $descriptors,
    $pipes,
    __DIR__,
    $env
);

if (!is_resource($process)) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['success' => false, 'error' => 'Failed to execute script']);
    exit;
}

// Write POST body to stdin
if ($stdin !== '') {
    fwrite($pipes[0], $stdin);
}
fclose($pipes[0]);

// Read stdout
$output = stream_get_contents($pipes[1]);
fclose($pipes[1]);

// Read stderr (for debugging)
$stderr = stream_get_contents($pipes[2]);
fclose($pipes[2]);

$exitCode = proc_close($process);

if ($exitCode !== 0 && $output === '') {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['success' => false, 'error' => 'Script error', 'detail' => $stderr]);
    exit;
}

// Parse CGI output: headers are separated from body by a blank line
$parts = explode("\r\n\r\n", $output, 2);
if (count($parts) < 2) {
    $parts = explode("\n\n", $output, 2);
}

$headerBlock = $parts[0] ?? '';
$body = $parts[1] ?? '';

// Send headers from the Python script
$headers = explode("\n", $headerBlock);
foreach ($headers as $header) {
    $header = trim($header);
    if ($header === '') continue;
    header($header);
}

echo $body;
