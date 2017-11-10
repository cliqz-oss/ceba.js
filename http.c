#include <stdio.h>
#include <stdlib.h>
#include <signal.h>
#include <unistd.h>
#include <evhttp.h>
#include <event2/event.h>
#include <event2/http.h>
#include <event2/bufferevent.h>
#include <string.h>
#include <emscripten.h>

extern struct event_base* tor_libevent_get_base(void);

struct MyContext {
  double id;
  struct evhttp_connection *conn;
  struct evhttp_request *req;
  struct evhttp_uri *http_uri;
  void (*cb)(double, const char *, int, const char *, int, char **, char **, int);
  char *uri;
};

void http_request_done(struct evhttp_request *req, void *arg){
    struct MyContext *ctx = ((struct MyContext *)arg);
    char buf[1024];
    if (req == NULL) {
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
    evhttp_connection_free(ctx->conn);
    evhttp_uri_free(ctx->http_uri);
    free(ctx->uri);
    free(ctx);
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
  void(*cb)(double, const char *error, int code, const char *body, int body_len, char **headers_keys_out, char **headers_values_out, int headers_out_cnt)
) {
  const char *scheme, *host, *path, *query, *error = NULL;
  char *uri = NULL;
  struct MyContext *ctx = NULL;
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

  ctx = malloc(sizeof(struct MyContext));
  ctx->uri = uri;
  ctx->id = id;
  ctx->cb = cb;
  ctx->http_uri = http_uri;
  ctx->conn = evhttp_connection_base_new(tor_libevent_get_base(), NULL, host, port);
  ctx->req = evhttp_request_new(http_request_done, ctx);
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

  evhttp_connection_set_timeout(ctx->req->evcon, timeout);

  if (error) {
_error:
    // TODO: check and free every possible thing!
    free(uri);
    evhttp_uri_free(http_uri);
    if (ctx) {
      evhttp_connection_free(ctx->conn);
      free(ctx);
    }
    cb(id, error, 0, NULL, 0, NULL, NULL, 0);
  }
}
