# cacheable-dns
## Install
```sh
# Please do not use Yarn v1 to install this package globally, Yarn v1 cannot properly patch dependencies.
npm install --global cacheable-dns
```

## Usage
```
Usage: cacheable-dns [options] <server>

Options:
  -V, --version                       output the version number
  --timeout [seconds]                  (default: "30")
  --port [port]                        (default: "53")
  --time-to-live [seconds]
  --stale-while-revalidate [seconds]
  --stale-if-error [seconds]
  --log [level]                        (default: "info")       
  -h, --help                          display help for command
```
