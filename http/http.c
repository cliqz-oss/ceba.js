#include <stdio.h>
#include <stdlib.h>
#include <signal.h>
#include <unistd.h>
#include <evhttp.h>
#include <event2/bufferevent_ssl.h>
#include <event2/bufferevent.h>
#include <event2/buffer.h>
#include <event2/listener.h>
#include <event2/util.h>
#include <event2/http.h>
#include <string.h>
#include <openssl/ssl.h>
#include <openssl/err.h>
#include <openssl/rand.h>
#include "openssl_hostname_validation.h"

#include <emscripten.h>

extern struct event_base* tor_libevent_get_base(void);

struct MyContext {
  double id;
  struct evhttp_connection *conn;
  struct evhttp_request *req;
  struct evhttp_uri *http_uri;
  void (*cb)(double, const char *, int, const char *, int, char **, char **, int);
  char *uri;
  SSL_CTX *ssl_ctx;
  SSL *ssl;
  struct bufferevent *bev;
};

/* See http://archives.seul.org/libevent/users/Jan-2013/msg00039.html */
static int cert_verify_callback(X509_STORE_CTX *x509_ctx, void *arg)
{
	char cert_str[256];
	const char *host = (const char *) arg;
	const char *res_str = "X509_verify_cert failed";
	HostnameValidationResult res = Error;

	/* This is the function that OpenSSL would call if we hadn't called
	 * SSL_CTX_set_cert_verify_callback().  Therefore, we are "wrapping"
	 * the default functionality, rather than replacing it. */
	int ok_so_far = 0;

	X509 *server_cert = NULL;

	// if (ignore_cert) {
	// 	return 1;
	// }

	ok_so_far = X509_verify_cert(x509_ctx);

	server_cert = X509_STORE_CTX_get_current_cert(x509_ctx);

	if (ok_so_far) {
		res = validate_hostname(host, server_cert);

		// switch (res) {
		// case MatchFound:
		// 	res_str = "MatchFound";
		// 	break;
		// case MatchNotFound:
		// 	res_str = "MatchNotFound";
		// 	break;
		// case NoSANPresent:
		// 	res_str = "NoSANPresent";
		// 	break;
		// case MalformedCertificate:
		// 	res_str = "MalformedCertificate";
		// 	break;
		// case Error:
		// 	res_str = "Error";
		// 	break;
		// default:
		// 	res_str = "WTF!";
		// 	break;
		// }
	}

  // TODO: is 256 bytes enough?
	X509_NAME_oneline(X509_get_subject_name (server_cert),
			  cert_str, sizeof (cert_str));

	if (res == MatchFound) {
		return 1;
	}
  return 0;
}

// TODO: check with valgrind for memleaks
void free_ctx(struct MyContext* ctx) {
  if (!ctx->conn) {
    // If ctx->conn is set they will call SSL_free
    SSL_free(ctx->ssl);
  }

  if (!ctx->ssl && ctx->ssl_ctx) {
    // If ssl is created, SSL_free with trigger SSL_CTX_free, otherwise
    // we need to do it ourselves
    SSL_CTX_free(ctx->ssl_ctx);
  }

  if (ctx->conn) {
    evhttp_connection_free(ctx->conn);
  }
  if (ctx->http_uri) {
    evhttp_uri_free(ctx->http_uri);
  }
  if (ctx->uri) {
    free(ctx->uri);
  }
  free(ctx);
}

void http_request_done(struct evhttp_request *req, void *arg){
    char buffer[256];
    struct MyContext *ctx = ((struct MyContext *)arg);
    char buf[1024];
    if (req == NULL) {
      /* If req is NULL, it means an error occurred, but
  		 * sadly we are mostly left guessing what the error
  		 * might have been.  We'll do our best... */
  		struct bufferevent *bev = ctx->bev;
  		unsigned long oslerr;
  		int printed_err = 0;
  		int errcode = EVUTIL_SOCKET_ERROR();
  		/* Print out the OpenSSL error queue that libevent
  		 * squirreled away for us, if any. */
  		while ((oslerr = bufferevent_get_openssl_error(bev))) {
  			ERR_error_string_n(oslerr, buffer, sizeof(buffer));
  			fprintf(stderr, "%s\n", buffer);
  			printed_err = 1;
  		}
  		/* If the OpenSSL error queue was empty, maybe it was a
  		 * socket error; let's try printing that. */
  		if (! printed_err)
  			fprintf(stderr, "socket error = %s (%d)\n",
  				evutil_socket_error_to_string(errcode),
  				errcode);

      // TODO: return some info to cb about error
      ctx->cb(ctx->id, "Request failed...", 0, NULL, 0, NULL, NULL, 0);
    } else {
      int code = evhttp_request_get_response_code(req);
      if (code == 0) {
        ctx->cb(ctx->id, "Request timed out...", 0, NULL, 0, NULL, NULL, 0);
      } else {
        struct evbuffer* buf = evhttp_request_get_input_buffer(req);
        size_t len = evbuffer_get_length(buf);
        char* data = malloc(len + 1);
        data[len] = 0;
        evbuffer_copyout(buf, data, len);

        struct evkeyvalq *header = evhttp_request_get_input_headers(req);
        struct evkeyval* kv = header->tqh_first;
        int headers_cnt = 0;
        while (kv) {
          ++headers_cnt;
          kv = kv->next.tqe_next;
        }

        char **headers_keys = malloc(headers_cnt * sizeof(char *));
        char **headers_values = malloc(headers_cnt * sizeof(char *));
        headers_cnt = 0;
        kv = header->tqh_first;
        while (kv) {
          headers_keys[headers_cnt] = kv->key;
          headers_values[headers_cnt] = kv->value;
          ++headers_cnt;
          kv = kv->next.tqe_next;
        }

        ctx->cb(ctx->id, NULL, code, data, len, headers_keys, headers_values, headers_cnt); // TODO: Limit body length...
        free(headers_keys);
        free(headers_values);
        free(data);
      }
    }
    free_ctx(ctx);
}

static void
err_openssl(const char *func)
{
	fprintf (stderr, "%s failed:\n", func);

	/* This is the OpenSSL function that prints the contents of the
	 * error stack to the specified file handle. */
	ERR_print_errors_fp (stderr);
}

void EMSCRIPTEN_KEEPALIVE myrequest(
  double id,
  char *url,
  char *method,
  char *headers_keys[],
  char *headers_values[],
  int headers_len,
  char *body_in,
  int body_in_len,
  int timeout,
  int retries,
  void(*cb)(double, const char *error, int code, const char *body, int body_len, char **headers_keys_out, char **headers_values_out, int headers_out_cnt)
) {
  static int ssl_init = 0;
  const char *crt = "/etc/ssl/certs/ca-certificates.crt";
  struct bufferevent *bev = NULL;
  struct event_base *base = tor_libevent_get_base();

  ////////////////////

  //////////////////////////////
  const char *scheme, *host, *path, *query, *error = NULL;
  char *uri = NULL;

  struct MyContext *ctx = malloc(sizeof(struct MyContext));
  memset(ctx, 0, sizeof(struct MyContext));

  // enum { HTTP, HTTPS } type = HTTP;
  struct evhttp_uri *http_uri = evhttp_uri_parse(url);

  if (http_uri == NULL) {
    error = "malformed_url";
    goto _error;
  }

  scheme = evhttp_uri_get_scheme(http_uri);
  if (scheme == NULL || (strcasecmp(scheme, "https") != 0 &&
                         strcasecmp(scheme, "http") != 0)) {
    error = "url must be http or https";
    goto _error;
  }

  host = evhttp_uri_get_host(http_uri);
  if (host == NULL) {
    error = "url must have a host";
    goto _error;
  }

  int port = evhttp_uri_get_port(http_uri);
  if (port == -1) {
    port = (strcasecmp(scheme, "http") == 0) ? 80 : 443;
  }

  path = evhttp_uri_get_path(http_uri);
  if (path == NULL || strlen(path) == 0) {
    path = "/";
  }

  query = evhttp_uri_get_query(http_uri);

  if (query == NULL) {
    size_t uri_len = strlen(path) + 1;
    uri = malloc(uri_len);
    snprintf(uri, uri_len, "%s", path);
  } else {
    size_t uri_len = strlen(path) + strlen(query) + 2;
    uri = malloc(uri_len);
    snprintf(uri, uri_len, "%s?%s", path, query);
  }

  enum evhttp_cmd_type method_code = EVHTTP_REQ_GET;
  if (strncmp(method, "GET", 3) == 0) {
    method_code = EVHTTP_REQ_GET;
  } else if (strncmp(method, "POST", 4) == 0) {
    method_code = EVHTTP_REQ_POST;
  } else if (strncmp(method, "HEAD", 4) == 0) {
    method_code = EVHTTP_REQ_HEAD;
  }

  if (strcasecmp(scheme, "http") == 0) {
    bev = bufferevent_socket_new(base, -1, BEV_OPT_CLOSE_ON_FREE);
  } else {
    if (!ssl_init) {
      // Initialize OpenSSL
      SSL_library_init();
      ERR_load_crypto_strings();
      SSL_load_error_strings();
      OpenSSL_add_all_algorithms();
      ssl_init = 1;
    }

    ctx->ssl_ctx = SSL_CTX_new(SSLv23_method());
  	if (!ctx->ssl_ctx) {
  		error = "SSL_CTX_new";
      err_openssl(error);
  		goto _error;
  	}

		if (SSL_CTX_load_verify_locations(ctx->ssl_ctx, crt, NULL) != 1) {
			error = "SSL_CTX_load_verify_locations";
      err_openssl(error);
			goto _error;
		}

    /* Ask OpenSSL to verify the server certificate.  Note that this
  	 * does NOT include verifying that the hostname is correct.
  	 * So, by itself, this means anyone with any legitimate
  	 * CA-issued certificate for any website, can impersonate any
  	 * other website in the world.  This is not good.  See "The
  	 * Most Dangerous Code in the World" article at
  	 * https://crypto.stanford.edu/~dabo/pubs/abstracts/ssl-client-bugs.html
  	 */
  	SSL_CTX_set_verify(ctx->ssl_ctx, SSL_VERIFY_PEER, NULL);

  	/* This is how we solve the problem mentioned in the previous
  	 * comment.  We "wrap" OpenSSL's validation routine in our
  	 * own routine, which also validates the hostname by calling
  	 * the code provided by iSECPartners.  Note that even though
  	 * the "Everything You've Always Wanted to Know About
  	 * Certificate Validation With OpenSSL (But Were Afraid to
  	 * Ask)" paper from iSECPartners says very explicitly not to
  	 * call SSL_CTX_set_cert_verify_callback (at the bottom of
  	 * page 2), what we're doing here is safe because our
  	 * cert_verify_callback() calls X509_verify_cert(), which is
  	 * OpenSSL's built-in routine which would have been called if
  	 * we hadn't set the callback.  Therefore, we're just
  	 * "wrapping" OpenSSL's routine, not replacing it. */
  	SSL_CTX_set_cert_verify_callback(ctx->ssl_ctx, cert_verify_callback, (void *) host);

    ctx->ssl = SSL_new(ctx->ssl_ctx);
    if (ctx->ssl == NULL) {
      // err_openssl("SSL_new()");
      error = "SSL_new";
      err_openssl(error);
      goto _error;
    }

    /* Configure a non-zero callback if desired */
    SSL_set_verify(ctx->ssl, SSL_VERIFY_PEER, 0);

    #ifdef SSL_CTRL_SET_TLSEXT_HOSTNAME
    // Set hostname for SNI extension
    SSL_set_tlsext_host_name(ctx->ssl, host);
    #endif

    bev = bufferevent_openssl_socket_new(base, -1, ctx->ssl, BUFFEREVENT_SSL_CONNECTING, BEV_OPT_CLOSE_ON_FREE|BEV_OPT_DEFER_CALLBACKS);
    if (bev == NULL) {
      error = "bufferevent_openssl_socket_new() failed";
      goto _error;
    }

    bufferevent_openssl_set_allow_dirty_shutdown(bev, 1);
  }

  // output_headers = evhttp_request_get_output_headers(req);
  // evhttp_add_header(output_headers, "Host", host);
  // evhttp_add_header(output_headers, "Connection", "close");

  ctx->bev = bev;
  ctx->uri = uri;
  ctx->id = id;
  ctx->cb = cb;
  ctx->http_uri = http_uri;
  ctx->conn = evhttp_connection_base_bufferevent_new(base, NULL, bev,	host, port);
  ctx->req = evhttp_request_new(http_request_done, ctx);

  // TODO: check if req is null (for every other calls too!!)
  struct evkeyvalq *output_headers = evhttp_request_get_output_headers(ctx->req);

  if (evhttp_add_header(output_headers, "Host", host) != 0) {
    error = "Error setting Host header";
    goto _error;
  }

  if (body_in_len) {
    if (evbuffer_add(evhttp_request_get_output_buffer(ctx->req), body_in, body_in_len) != 0) {
      error = "Error setting body";
      goto _error;
    }
  }

  for (int i = 0; i < headers_len; ++i) {
    // TODO: check headers, do not replace "Host"...
    if (evhttp_add_header(output_headers, headers_keys[i], headers_values[i]) != 0) {
      error = "Error setting header";
      goto _error;
    };
  }

  if (evhttp_make_request(ctx->conn, ctx->req, method_code, uri) != 0) {
    error = "Error making request";
    goto _error;
  }

  if (retries > 0) {
    evhttp_connection_set_retries(ctx->req->evcon, retries);
  }
  if (timeout >= 0) {
    evhttp_connection_set_timeout(ctx->req->evcon, timeout);
  }

  if (error) {
_error:
    free_ctx(ctx);
    cb(id, error, 0, NULL, 0, NULL, NULL, 0);
  }
}
