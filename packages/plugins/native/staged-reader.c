/* Experimental Node-API reader. The caller must trust the parent directory.
 * A regular file can still be changed through another already-open handle. */
#include <node_api.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

#ifndef STAGED_MAX_BYTES
#define STAGED_MAX_BYTES ((size_t)512 * 1024 * 1024)
#endif
#define MAX_BYTES STAGED_MAX_BYTES
typedef struct {
  napi_async_work work;
  napi_deferred deferred;
#ifdef _WIN32
  uint16_t *path;
#else
  char *path;
#endif
  unsigned char *data;
  size_t length;
  const char *error;
  const char *code;
} read_job;

static void execute(napi_env env, void *opaque) {
  read_job *j = opaque;
  size_t cap = MAX_BYTES < 65536 ? MAX_BYTES : 65536;
  (void)env;
#ifdef _WIN32
  HANDLE file = CreateFileW((const wchar_t *)j->path, GENERIC_READ,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, NULL, OPEN_EXISTING,
      FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_SEQUENTIAL_SCAN, NULL);
  FILE_ATTRIBUTE_TAG_INFO info;
  if (file == INVALID_HANDLE_VALUE) {
    DWORD e = GetLastError();
    j->error = "STAGED_FILE_OPEN_FAILED";
    if (e == ERROR_FILE_NOT_FOUND || e == ERROR_PATH_NOT_FOUND) j->code = "ENOENT";
    return;
  }
  if (GetFileType(file) != FILE_TYPE_DISK ||
      !GetFileInformationByHandleEx(file, FileAttributeTagInfo, &info, sizeof(info)) ||
      (info.FileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY))) {
    j->error = "STAGED_FILE_UNSAFE"; goto done;
  }
#else
  int file = open(j->path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  struct stat info;
  if (file < 0) {
    j->error = errno == ELOOP ? "STAGED_FILE_UNSAFE" : "STAGED_FILE_OPEN_FAILED";
    if (errno == ENOENT) j->code = "ENOENT";
    return;
  }
  if (fstat(file, &info) || !S_ISREG(info.st_mode)) { j->error = "STAGED_FILE_UNSAFE"; goto done; }
#endif
  j->data = malloc(cap);
  if (!j->data) { j->error = "STAGED_FILE_OUT_OF_MEMORY"; goto done; }
  for (;;) {
    size_t room = cap - j->length;
#ifdef _WIN32
    DWORD n = 0;
    if (!ReadFile(file, j->data + j->length, (DWORD)room, &n, NULL)) {
      j->error = "STAGED_FILE_READ_FAILED"; goto done;
    }
#else
    ssize_t n = read(file, j->data + j->length, room);
    if (n < 0) { j->error = "STAGED_FILE_READ_FAILED"; goto done; }
#endif
    if (!n) break;
    j->length += (size_t)n;
    if (j->length == cap) {
      unsigned char *next;
      if (cap == MAX_BYTES) {
        unsigned char extra;
#ifdef _WIN32
        DWORD more = 0;
        if (!ReadFile(file, &extra, 1, &more, NULL)) j->error = "STAGED_FILE_READ_FAILED";
#else
        ssize_t more = read(file, &extra, 1);
        if (more < 0) j->error = "STAGED_FILE_READ_FAILED";
#endif
        if (more > 0) j->error = "STAGED_FILE_TOO_LARGE";
        break;
      }
      cap = cap > MAX_BYTES / 2 ? MAX_BYTES : cap * 2;
      next = realloc(j->data, cap);
      if (!next) { j->error = "STAGED_FILE_OUT_OF_MEMORY"; goto done; }
      j->data = next;
    }
  }
done:
#ifdef _WIN32
  CloseHandle(file);
#else
  close(file);
#endif
}
static void complete(napi_env env, napi_status status, void *opaque) {
  read_job *j = opaque;
  napi_value value, message, code;
  if (status != napi_ok && !j->error) j->error = "STAGED_FILE_READ_FAILED";
  if (!j->error && napi_create_buffer_copy(env, j->length, j->data, NULL, &value) != napi_ok)
    j->error = "STAGED_FILE_OUT_OF_MEMORY";
  if (j->error) {
    napi_create_string_utf8(env, j->error, NAPI_AUTO_LENGTH, &message);
    if (j->code) {
      napi_create_string_utf8(env, j->code, NAPI_AUTO_LENGTH, &code);
      napi_create_error(env, code, message, &value);
    } else napi_create_error(env, NULL, message, &value);
    napi_reject_deferred(env, j->deferred, value);
  } else napi_resolve_deferred(env, j->deferred, value);
  napi_delete_async_work(env, j->work);
  free(j->data); free(j->path); free(j);
}
static napi_value read_file(napi_env env, napi_callback_info info) {
  size_t argc = 1, length = 0, copied = 0;
  napi_value arg, promise, name;
  read_job *j = calloc(1, sizeof(*j));
  if (!j) { napi_throw_error(env, NULL, "STAGED_FILE_OUT_OF_MEMORY"); return NULL; }
  if (napi_get_cb_info(env, info, &argc, &arg, NULL, NULL) != napi_ok || argc != 1) goto invalid;
#ifdef _WIN32
  if (napi_get_value_string_utf16(env, arg, NULL, 0, &length) != napi_ok || !length) goto invalid;
  j->path = calloc(length + 1, sizeof(*j->path));
  if (!j->path || napi_get_value_string_utf16(env, arg, j->path, length + 1, &copied) != napi_ok) goto invalid;
#else
  if (napi_get_value_string_utf8(env, arg, NULL, 0, &length) != napi_ok || !length) goto invalid;
  j->path = calloc(length + 1, sizeof(*j->path));
  if (!j->path || napi_get_value_string_utf8(env, arg, j->path, length + 1, &copied) != napi_ok) goto invalid;
#endif
  /* Embedded NUL must never turn the validated path into another path. */
  for (size_t i = 0; i < copied; i++) if (!j->path[i]) goto invalid;
  if (napi_create_promise(env, &j->deferred, &promise) != napi_ok ||
      napi_create_string_utf8(env, "staged-read", NAPI_AUTO_LENGTH, &name) != napi_ok ||
      napi_create_async_work(env, NULL, name, execute, complete, j, &j->work) != napi_ok) goto invalid;
  if (napi_queue_async_work(env, j->work) != napi_ok) { napi_delete_async_work(env, j->work); goto invalid; }
  return promise;
invalid:
  free(j->path); free(j);
  napi_throw_error(env, NULL, "STAGED_FILE_INVALID_REQUEST"); return NULL;
}
static napi_value init(napi_env env, napi_value exports) {
  napi_value fn;
  if (napi_create_function(env, "read", NAPI_AUTO_LENGTH, read_file, NULL, &fn) != napi_ok ||
      napi_set_named_property(env, exports, "read", fn) != napi_ok) return NULL;
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
