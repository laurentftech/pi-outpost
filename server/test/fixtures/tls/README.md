# TLS test fixtures

The certificate and **publicly committed, test-only** private key identify localhost,
127.0.0.1 and ::1. They are not production credentials. Tests explicitly trust this certificate;
production TLS never disables certificate verification or installs this trust.

Generated with OpenSSL on 2026-11-08:

```sh
openssl req -config openssl.cnf -x509 -newkey rsa:2048 -sha256 -nodes -keyout test-key.pem -out test-cert.pem -days 3650 -subj /CN=localhost -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1'
openssl x509 -in test-cert.pem -signkey test-key.pem -not_before 20200101000000Z -not_after 20210101000000Z -out expired-cert.pem
openssl x509 -in test-cert.pem -signkey test-key.pem -not_before 20400101000000Z -not_after 20410101000000Z -out future-cert.pem
```

The expired certificate exercises fail-closed startup. No OpenSSL installation is required to run
the tests. Regenerate the valid fixture before its ten-year validity ends.
