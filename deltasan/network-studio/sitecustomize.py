"""Use native Windows certificate validation in the Studio Python runtime."""

import sys

if sys.platform == "win32":
    import truststore

    truststore.inject_into_ssl()

    if "neuro_san_studio.runner.neuro_san_server_wrapper" in sys.orig_argv:
        from studio_mcp import configure_you_transport

        configure_you_transport()
