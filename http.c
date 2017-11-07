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
  void (*cb)(double, const char *, int, const char *, int);
  char *uri;
};

void http_request_done(struct evhttp_request *req, void *arg){
    struct MyContext *ctx = ((struct MyContext *)arg);
    char buf[1024];
    if (req == NULL) {
      ctx->cb(ctx->id, "Request failed...", 0, NULL, 0);
    } else {
      int code = evhttp_request_get_response_code(req);
      if (code == 0) {
        ctx->cb(ctx->id, "Request timed out...", 0, NULL, 0);
      } else {
        struct evbuffer* buf = evhttp_request_get_input_buffer(req);
        size_t len = evbuffer_get_length(buf);
        char* data = malloc(len + 1);
        data[len] = 0;
        evbuffer_copyout(buf, data, len);
        ctx->cb(ctx->id, NULL, code, data, len); // TODO: Limit body length...
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
  int timeout,
  void(*cb)(double, const char *error, int code, const char *body, int body_len)
) {
  struct evhttp_uri *http_uri = evhttp_uri_parse(url);
  const char *scheme, *host, *path, *query, *error;
  char *uri = NULL;

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

  size_t uri_len;
  if (query == NULL) {
    uri_len = strlen(path);
    uri = malloc(uri_len + 1);
    snprintf(uri, uri_len, "%s", path);
  } else {
    uri_len = strlen(path) + strlen(query) + 1;
    uri = malloc(uri_len + 1);
    snprintf(uri, uri_len, "%s?%s", path, query);
  }
  uri[uri_len] = '\0';

  // TODO: better way?
  if (error) {
_error:
    free(uri);
    evhttp_uri_free(http_uri);
    cb(id, error, 0, NULL, 0);
    return;
  }

  enum evhttp_cmd_type method_code = EVHTTP_REQ_GET;
  if (strncmp(method, "GET", 3) == 0) {
    method_code = EVHTTP_REQ_GET;
  } else if (strncmp(method, "POST", 4) == 0) {
    method_code = EVHTTP_REQ_POST;
  }

  struct MyContext *ctx = malloc(sizeof(struct MyContext));

  ctx->uri = uri;
  ctx->id = id;
  ctx->cb = cb;
  ctx->http_uri = http_uri;
  ctx->conn = evhttp_connection_base_new(tor_libevent_get_base(), NULL, host, port);
  ctx->req = evhttp_request_new(http_request_done, ctx);
  evhttp_add_header(ctx->req->output_headers, "Host", host);
  evhttp_make_request(ctx->conn, ctx->req, method_code, uri);
  evhttp_connection_set_timeout(ctx->req->evcon, timeout);
}
