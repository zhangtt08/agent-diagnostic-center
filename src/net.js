import net from 'node:net';

/**
 * 从 start 开始向后寻找可用端口。用户的开发机上常驻着其它本地服务，
 * 直接抛 EADDRINUSE 会让"双击即用"失败，所以这里自动让位。
 */
export function findFreePort(start = 4173, attempts = 40) {
  return new Promise((resolve, reject) => {
    let port = start;
    const tryOnce = () => {
      const tester = net.createServer();
      tester.once('error', (err) => {
        if ((err.code === 'EADDRINUSE' || err.code === 'EACCES') && port - start < attempts) {
          port += 1;
          tryOnce();
        } else {
          reject(Object.assign(new Error(`无法找到可用端口（从 ${start} 开始尝试 ${attempts} 次）：${err.message}`), { code: err.code }));
        }
      });
      tester.once('listening', () => tester.close(() => resolve(port)));
      tester.listen(port, '127.0.0.1');
    };
    tryOnce();
  });
}
