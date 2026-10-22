// Creates a sample local project and a diverged remote copy for trying Deplox.
//   node dev/seed.mjs   →  dev/local-project  and  dev/remote/var/www/app
import { mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const local = join(here, 'local-project')
const remote = join(here, 'remote/var/www/app')
rmSync(local, { recursive: true, force: true })
rmSync(join(here, 'remote'), { recursive: true, force: true })

const put = (root, rel, text, ageMin = 0) => {
  const p = join(root, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, text)
  if (ageMin) {
    const t = new Date(Date.now() - ageMin * 60_000)
    utimesSync(p, t, t)
  }
}

const mwRemote = `<?php

namespace App\\Http\\Middleware;

use Closure;
use Illuminate\\Http\\Request;
use Illuminate\\Support\\Facades\\Log;
use Symfony\\Component\\HttpFoundation\\Response;

class VerifyIntegrityMiddleware
{
    public function handle(Request $request, Closure $next): Response
    {
        return $next($request);

        $token = $request->header('X-Integrity-Token');
        $pkg   = $request->header('X-Integrity-Package');
        Log::debug('integrity', ['pkg' => $pkg]);

        if (! $token) {
            return response()->json([
                'success' => false,
                'message' => 'No integrity token provided',
            ], 401);
        }

        return $next($request);
    }
}
`
const mwLocal = `<?php

namespace App\\Http\\Middleware;

use Closure;
use Carbon\\Carbon;
use Illuminate\\Http\\Request;
use Illuminate\\Support\\Facades\\Log;
use Symfony\\Component\\HttpFoundation\\Response;

class VerifyIntegrityMiddleware
{
    public function handle(Request $request, Closure $next): Response
    {
        $isDevelopment = config('app.env') === 'development';

        // Skip Play Integrity check in development
        if ($isDevelopment) {
            return $next($request);
        }

        $token = $request->header('X-Integrity-Token');
        $pkg   = $request->header('X-Integrity-Package');

        if (! $token) {
            return response()->json([
                'success' => false,
                'message' => 'No integrity token provided',
            ], 401);
        }

        return $next($request);
    }
}
`
const same = {
  'app/Http/Controllers/PaymentController.php': "<?php\n\nnamespace App\\Http\\Controllers;\n\nclass PaymentController extends Controller\n{\n    public function store()\n    {\n        return response()->json(['ok' => true]);\n    }\n}\n",
  'app/Http/Middleware/Authenticate.php': "<?php\n\nnamespace App\\Http\\Middleware;\n\nclass Authenticate\n{\n}\n",
  'routes/web.php': "<?php\n\nRoute::get('/', fn () => view('welcome'));\n",
  'composer.json': JSON.stringify({ name: 'deplox/demo-app', require: { php: '^8.3', 'laravel/framework': '^12.0' } }, null, 2) + '\n',
  'config/app.php': "<?php\n\nreturn [\n    'name' => env('APP_NAME', 'deplox-demo'),\n    'env' => env('APP_ENV', 'production'),\n];\n"
}
for (const [rel, text] of Object.entries(same)) {
  put(local, rel, text, 120)
  put(remote, rel, text, 120)
}
put(local, 'app/Http/Middleware/VerifyIntegrityMiddleware.php', mwLocal, 5)
put(remote, 'app/Http/Middleware/VerifyIntegrityMiddleware.php', mwRemote, 60)
put(local, 'app/Http/Controllers/OrderController.php', "<?php\n\nclass OrderController\n{\n    public function index()\n    {\n        return Order::latest()->paginate(20);\n    }\n}\n", 10)
put(remote, 'app/Http/Controllers/OrderController.php', "<?php\n\nclass OrderController\n{\n    public function index()\n    {\n        return Order::all();\n    }\n}\n", 90)
put(local, 'app/Http/Controllers/WebhookController.php', "<?php\n\nclass WebhookController\n{\n}\n", 3)
put(local, 'routes/api.php', "<?php\n\nRoute::post('/orders', [OrderController::class, 'store']);\nRoute::post('/webhook', WebhookController::class);\n", 8)
put(remote, 'routes/api.php', "<?php\n\nRoute::post('/orders', [OrderController::class, 'store']);\n", 200)
put(local, '.env', 'APP_ENV=development\n')
put(remote, '.env', 'APP_ENV=production\nAPP_KEY=base64:example\n')
put(remote, 'storage/logs/laravel.log', Array.from({ length: 200 }, (_, i) => `[2026-10-21 13:${String(i % 60).padStart(2, '0')}:00] production.INFO: line ${i}`).join('\n') + '\n')
put(local, 'node_modules/left-pad/index.js', 'module.exports = () => {}\n')
console.log('Seeded', local, 'and', remote)
