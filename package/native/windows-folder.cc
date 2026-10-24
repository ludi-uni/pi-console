// SOURCE CANDIDATE ONLY. Uncompiled and unexecuted. Not loaded by Console.
// Build only with the matching official Node-API headers and node.lib.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <winternl.h>
#include <winioctl.h>
#include <node_api.h>
#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <memory>
#include <string>
#include <unordered_set>
#include <vector>

using NtCreate = NTSTATUS (NTAPI *)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES,
    PIO_STATUS_BLOCK, PLARGE_INTEGER, ULONG, ULONG, ULONG, ULONG, PVOID, ULONG);
struct Event { uint32_t id; const char* action; const char* api; uint32_t code; };
struct State;
struct Lease { HANDLE value; uint32_t id; bool created; bool externalBound; std::shared_ptr<State> owner; };
struct State : std::enable_shared_from_this<State> {
  NtCreate create = nullptr;
  uint32_t sequence = 0;
  std::unordered_set<Lease*> leases;
  std::vector<Event> events;
  std::wstring fixtureRoot;
  std::unordered_set<std::wstring> junctions;
};
static const napi_type_tag leaseTag = { 0x49c9af73a6d948a1ULL, 0xb38451908ed44aa0ULL };
struct Fault { const char* api; uint32_t code; };
static void check(napi_status s) { if (s != napi_ok) throw Fault{ "node_api", static_cast<uint32_t>(s) }; }
static void win(bool ok, const char* api) { if (!ok) throw Fault{ api, GetLastError() }; }
static State* state(napi_env e) { void* p = nullptr; check(napi_get_instance_data(e, &p)); return static_cast<std::shared_ptr<State>*>(p)->get(); }
static napi_value undef(napi_env e) { napi_value v; check(napi_get_undefined(e, &v)); return v; }
static napi_value number(napi_env e, uint32_t x) { napi_value v; check(napi_create_uint32(e, x, &v)); return v; }
static napi_value boolean(napi_env e, bool x) { napi_value v; check(napi_get_boolean(e, x, &v)); return v; }
static napi_value text(napi_env e, const std::string& x) { napi_value v; check(napi_create_string_utf8(e, x.c_str(), x.size(), &v)); return v; }
static napi_value text(napi_env e, const std::wstring& x) {
  static_assert(sizeof(wchar_t) == sizeof(char16_t)); napi_value v;
  check(napi_create_string_utf16(e, reinterpret_cast<const char16_t*>(x.data()), x.size(), &v)); return v;
}
static void set(napi_env e, napi_value o, const char* k, napi_value v) { check(napi_set_named_property(e, o, k, v)); }
static std::vector<napi_value> args(napi_env e, napi_callback_info ci, size_t count) {
  std::vector<napi_value> a(count + 1); size_t n = a.size(); check(napi_get_cb_info(e, ci, &n, a.data(), nullptr, nullptr));
  if (n != count) throw Fault{ "argument_count", ERROR_INVALID_PARAMETER }; a.resize(count); return a;
}
static std::wstring string(napi_env e, napi_value v) {
  size_t n = 0; check(napi_get_value_string_utf16(e, v, nullptr, 0, &n));
  if (!n || n > 1024) throw Fault{ "string_length", ERROR_INVALID_PARAMETER };
  std::vector<char16_t> b(n + 1); check(napi_get_value_string_utf16(e, v, b.data(), b.size(), &n));
  std::wstring out(reinterpret_cast<wchar_t*>(b.data()), n);
  if (out.find(L'\0') != std::wstring::npos) throw Fault{ "embedded_nul", ERROR_INVALID_PARAMETER }; return out;
}
static std::wstring lower(std::wstring x) { for (auto& c : x) if (c >= L'A' && c <= L'Z') c += L'a' - L'A'; return x; }
static bool component(const std::wstring& n) {
  if (n.empty() || n.size() > 80 || n == L"." || n == L".." || n.back() == L'.') return false;
  return std::all_of(n.begin(), n.end(), [](wchar_t c) { return (c >= L'a' && c <= L'z') || (c >= L'A' && c <= L'Z') || (c >= L'0' && c <= L'9') || c == L'.' || c == L'_' || c == L'-'; });
}
static std::wstring finalPath(HANDLE h) {
  std::vector<wchar_t> b(32768); DWORD n = GetFinalPathNameByHandleW(h, b.data(), static_cast<DWORD>(b.size()), FILE_NAME_NORMALIZED | VOLUME_NAME_GUID);
  win(n != 0 && n < b.size(), "GetFinalPathNameByHandleW"); return std::wstring(b.data(), n);
}
static bool closeLease(State* s, Lease* l) {
  if (l->value == INVALID_HANDLE_VALUE) return true;
  if (!CloseHandle(l->value)) { s->events.push_back({ l->id, "close_failed", "CloseHandle", GetLastError() }); return false; }
  l->value = INVALID_HANDLE_VALUE; s->events.push_back({ l->id, "closed", "CloseHandle", 0 }); return true;
}
struct ImmediateHandleGuard {
  HANDLE value;
  ~ImmediateHandleGuard() { if (value != INVALID_HANDLE_VALUE) CloseHandle(value); }
};
static Lease* own(State* s, HANDLE h, bool created, const char* api) {
  // Every successfully acquired Windows handle becomes ledger-owned before any query.
  ImmediateHandleGuard acquired{ h };
  auto pending = std::make_unique<Lease>(Lease{ h, ++s->sequence, created, false, s->shared_from_this() }); auto* l = pending.get();
  s->leases.insert(l);
  try { s->events.push_back({ l->id, "opened", api, 0 }); } catch (...) { s->leases.erase(l); throw; }
  pending.release(); acquired.value = INVALID_HANDLE_VALUE;
  try {
    win(SetHandleInformation(h, HANDLE_FLAG_INHERIT, 0) != 0, "SetHandleInformation"); DWORD flags = 0;
    win(GetHandleInformation(h, &flags) != 0, "GetHandleInformation");
    if (flags & HANDLE_FLAG_INHERIT) throw Fault{ "inheritable_handle", ERROR_INVALID_HANDLE };
  } catch (...) { closeLease(s, l); throw; } return l;
}
static void finalizeLease(napi_env, void* data, void*) {
  auto* l = static_cast<Lease*>(data); auto owner = l->owner; auto* s = owner.get(); l->externalBound = false;
  try { if (closeLease(s, l)) { s->leases.erase(l); delete l; } }
  catch (...) { if (l->value != INVALID_HANDLE_VALUE && CloseHandle(l->value)) l->value = INVALID_HANDLE_VALUE; }
  // On close failure keep ledger ownership; closeAll/environment cleanup can report it.
}
static napi_value external(napi_env e, State* s, Lease* l) {
  napi_value v;
  try { check(napi_create_external(e, l, finalizeLease, nullptr, &v)); l->externalBound = true; check(napi_type_tag_object(e, v, &leaseTag)); return v; }
  catch (...) { closeLease(s, l); throw; }
}
static Lease* lease(napi_env e, napi_value v) {
  bool tagged = false; check(napi_check_object_type_tag(e, v, &leaseTag, &tagged));
  if (!tagged) throw Fault{ "foreign_handle", ERROR_INVALID_HANDLE };
  void* p = nullptr; check(napi_get_value_external(e, v, &p)); auto* s = state(e); auto* l = static_cast<Lease*>(p);
  if (!s->leases.count(l) || l->value == INVALID_HANDLE_VALUE) throw Fault{ "closed_handle", ERROR_INVALID_HANDLE }; return l;
}
template<class Work> static napi_value safe(napi_env e, Work work) {
  try { return work(); }
  catch (const Fault& f) {
    napi_value message, error, code; napi_create_string_utf8(e, f.api, NAPI_AUTO_LENGTH, &message);
    napi_create_string_utf8(e, "windows_folder_failure", NAPI_AUTO_LENGTH, &code); napi_create_error(e, code, message, &error);
    napi_value value; napi_create_uint32(e, f.code, &value); napi_set_named_property(e, error, "status", value); napi_throw(e, error); return nullptr;
  } catch (...) { napi_throw_error(e, "windows_folder_failure", "native_internal_failure"); return nullptr; }
}
static napi_value openRoot(napi_env e, napi_callback_info ci) { return safe(e, [&] {
  auto a = args(e, ci, 1); auto drive = lower(string(e, a[0]));
  if (drive.size() != 2 || drive[0] < L'a' || drive[0] > L'z' || drive[1] != L':') throw Fault{ "drive", ERROR_INVALID_PARAMETER };
  auto path = drive + L"\\";
  // Volume root is traversal only. It is not the selected permission boundary.
  HANDLE h = CreateFileW(path.c_str(), FILE_READ_ATTRIBUTES | FILE_TRAVERSE | SYNCHRONIZE, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
  win(h != INVALID_HANDLE_VALUE, "CreateFileW_root"); auto* s = state(e); return external(e, s, own(s, h, false, "CreateFileW_root"));
}); }
static Lease* relative(State* s, Lease* parent, const std::wstring& name, bool directory, bool create, bool pinned = true) {
  if (!component(name)) throw Fault{ "single_component", ERROR_INVALID_PARAMETER };
  UNICODE_STRING u{}; u.Buffer = const_cast<PWSTR>(name.data()); u.Length = static_cast<USHORT>(name.size() * sizeof(wchar_t)); u.MaximumLength = u.Length;
  OBJECT_ATTRIBUTES oa{}; oa.Length = sizeof(oa); oa.RootDirectory = parent->value; oa.ObjectName = &u; oa.Attributes = OBJ_CASE_INSENSITIVE;
  IO_STATUS_BLOCK io{}; HANDLE h = INVALID_HANDLE_VALUE;
  ACCESS_MASK access = FILE_READ_ATTRIBUTES | SYNCHRONIZE | (directory ? FILE_TRAVERSE : (create ? GENERIC_WRITE : 0));
  // Candidate combination: actual compatibility/no-follow behavior requires the owned OS run.
  ULONG options = FILE_SYNCHRONOUS_IO_NONALERT | FILE_OPEN_REPARSE_POINT | (directory ? FILE_DIRECTORY_FILE : FILE_NON_DIRECTORY_FILE);
  const ULONG sharing = create || pinned ? FILE_SHARE_READ : FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;
  NTSTATUS status = s->create(&h, access, &oa, &io, nullptr, FILE_ATTRIBUTE_NORMAL, sharing,
      create ? FILE_CREATE : FILE_OPEN, options, nullptr, 0);
  if (status != 0) { if (h != INVALID_HANDLE_VALUE && h != nullptr) closeLease(s, own(s, h, false, "NtCreateFile_nonzero")); throw Fault{ "NtCreateFile", static_cast<uint32_t>(status) }; }
  auto* l = own(s, h, create, "NtCreateFile");
  if (io.Information != static_cast<ULONG_PTR>(create ? FILE_CREATED : FILE_OPENED)) { closeLease(s, l); throw Fault{ "unexpected_disposition", ERROR_INVALID_DATA }; }
  return l;
}
static napi_value openDirectory(napi_env e, napi_callback_info ci) { return safe(e, [&] {
  auto a = args(e, ci, 3); bool pinned = false; check(napi_get_value_bool(e, a[2], &pinned));
  auto* s = state(e); return external(e, s, relative(s, lease(e, a[0]), string(e, a[1]), true, false, pinned));
}); }
static napi_value createDirectory(napi_env e, napi_callback_info ci) { return safe(e, [&] {
  auto a = args(e, ci, 2); auto* s = state(e); return external(e, s, relative(s, lease(e, a[0]), string(e, a[1]), true, true));
}); }
static napi_value createFile(napi_env e, napi_callback_info ci) { return safe(e, [&] {
  auto a = args(e, ci, 3); bool isBuffer = false; check(napi_is_buffer(e, a[2], &isBuffer));
  if (!isBuffer) throw Fault{ "bounded_buffer", ERROR_INVALID_PARAMETER };
  void* bytes = nullptr; size_t size = 0; check(napi_get_buffer_info(e, a[2], &bytes, &size));
  if (size > 4096) throw Fault{ "bounded_buffer", ERROR_INVALID_PARAMETER };
  auto* s = state(e); auto* l = relative(s, lease(e, a[0]), string(e, a[1]), false, true);
  try { DWORD done = 0; win(WriteFile(l->value, bytes, static_cast<DWORD>(size), &done, nullptr) != 0, "WriteFile");
    if (done != size) throw Fault{ "short_write", ERROR_WRITE_FAULT }; win(FlushFileBuffers(l->value) != 0, "FlushFileBuffers");
    return external(e, s, l);
  } catch (...) { closeLease(s, l); throw; }
}); }
static std::string hex(const unsigned char* b, size_t n) {
  static const char* digits = "0123456789abcdef"; std::string out; for (size_t i = 0; i < n; ++i) { out += digits[b[i] >> 4]; out += digits[b[i] & 15]; } return out;
}
static napi_value info(napi_env e, napi_callback_info ci) { return safe(e, [&] {
  auto a = args(e, ci, 1); auto* l = lease(e, a[0]); FILE_ATTRIBUTE_TAG_INFO tag{}; FILE_ID_INFO id{};
  win(GetFileInformationByHandleEx(l->value, FileAttributeTagInfo, &tag, sizeof(tag)) != 0, "FileAttributeTagInfo");
  win(GetFileInformationByHandleEx(l->value, FileIdInfo, &id, sizeof(id)) != 0, "FileIdInfo");
  bool directory = (tag.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0; FILE_CASE_SENSITIVE_INFO sensitive{};
  if (directory) win(GetFileInformationByHandleEx(l->value, FileCaseSensitiveInfo, &sensitive, sizeof(sensitive)) != 0, "FileCaseSensitiveInfo");
  auto path = finalPath(l->value), folded = lower(path);
  if (folded.rfind(L"\\\\?\\volume{", 0) != 0 || folded.size() < 49 || folded[47] != L'}' || folded[48] != L'\\') throw Fault{ "physical_volume_path", ERROR_INVALID_DATA };
  unsigned char serial[8]; for (size_t i = 0; i < 8; ++i) serial[i] = static_cast<unsigned char>(id.VolumeSerialNumber >> ((7 - i) * 8));
  napi_value o; check(napi_create_object(e, &o)); set(e, o, "volume", text(e, hex(serial, 8))); set(e, o, "fileId", text(e, hex(id.FileId.Identifier, 16)));
  set(e, o, "volumeGuid", text(e, folded.substr(11, 36))); set(e, o, "stablePath", text(e, path)); set(e, o, "directory", boolean(e, directory));
  set(e, o, "reparse", boolean(e, (tag.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)); set(e, o, "reparseTag", number(e, tag.ReparseTag));
  set(e, o, "caseSensitive", boolean(e, sensitive.Flags != 0)); set(e, o, "created", boolean(e, l->created)); set(e, o, "auditId", number(e, l->id)); return o;
}); }
static napi_value assertVolume(napi_env e, napi_callback_info ci) { return safe(e, [&] {
  auto a = args(e, ci, 1); auto* l = lease(e, a[0]); auto path = finalPath(l->value);
  auto end = path.find(L"}\\"); if (end == std::wstring::npos || end + 2 != path.size()) throw Fault{ "volume_root", ERROR_INVALID_DATA };
  wchar_t filesystem[64]{}; DWORD flags = 0;
  win(GetVolumeInformationByHandleW(l->value, nullptr, 0, nullptr, nullptr, &flags, filesystem, 64) != 0, "GetVolumeInformationByHandleW");
  if (GetDriveTypeW(path.c_str()) != DRIVE_FIXED || _wcsicmp(filesystem, L"NTFS") != 0 || !(flags & FILE_SUPPORTS_OPEN_BY_FILE_ID)) throw Fault{ "unsupported_volume", ERROR_NOT_SUPPORTED };
  return undef(e);
}); }
static napi_value close(napi_env e, napi_callback_info ci) { return safe(e, [&] {
  auto a = args(e, ci, 1); if (!closeLease(state(e), lease(e, a[0]))) throw Fault{ "CloseHandle", GetLastError() }; return undef(e);
}); }
static napi_value closeAll(napi_env e, napi_callback_info ci) { return safe(e, [&] {
  args(e, ci, 0); auto* s = state(e); bool ok = true; for (auto* l : s->leases) if (!closeLease(s, l)) ok = false;
  if (!ok) throw Fault{ "CloseHandle_cleanup", ERROR_INVALID_HANDLE }; return undef(e);
}); }
static napi_value audit(napi_env e, napi_callback_info ci) { return safe(e, [&] {
  args(e, ci, 0); auto* s = state(e); napi_value out, events, live; check(napi_create_object(e, &out)); check(napi_create_array(e, &events)); check(napi_create_array(e, &live));
  uint32_t i = 0; for (const auto& x : s->events) { napi_value o; check(napi_create_object(e, &o)); set(e, o, "id", number(e, x.id)); set(e, o, "action", text(e, x.action)); set(e, o, "api", text(e, x.api)); set(e, o, "status", number(e, x.code)); check(napi_set_element(e, events, i++, o)); }
  i = 0; for (const auto* l : s->leases) if (l->value != INVALID_HANDLE_VALUE) check(napi_set_element(e, live, i++, number(e, l->id)));
  set(e, out, "events", events); set(e, out, "liveIds", live); set(e, out, "liveCount", number(e, i)); return out;
}); }

#ifdef FOLDER_FIXTURE_PROBES
// Dedicated test helpers. Never compile/load these into production Console.
// All mutation paths are a single immediate child of the configured owned fixture.
static std::wstring probePath(State* s, const std::wstring& input) {
  auto p = lower(input), prefix = s->fixtureRoot + L"\\";
  if (s->fixtureRoot.empty() || p.rfind(prefix, 0) != 0 || !component(p.substr(prefix.size()))) throw Fault{ "fixture_path", ERROR_ACCESS_DENIED }; return input;
}
static Lease* probeOpen(State* s, const std::wstring& p, ACCESS_MASK access) {
  HANDLE h = CreateFileW(p.c_str(), access, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
  win(h != INVALID_HANDLE_VALUE, "CreateFileW_probe"); return own(s, h, false, "CreateFileW_probe");
}
static napi_value configure(napi_env e, napi_callback_info ci) { return safe(e, [&] {
  auto a = args(e, ci, 1); auto* s = state(e); auto p = lower(string(e, a[0]));
  if (!s->fixtureRoot.empty() || p.size() < 4 || p[1] != L':' || p[2] != L'\\') throw Fault{ "fixture_root", ERROR_INVALID_PARAMETER };
  for (size_t offset = 3; offset < p.size();) { auto end = p.find(L'\\', offset); if (!component(p.substr(offset, end == std::wstring::npos ? p.size() - offset : end - offset))) throw Fault{ "fixture_root", ERROR_INVALID_PARAMETER }; if (end == std::wstring::npos) break; offset = end + 1; }
  s->fixtureRoot = p; return undef(e);
}); }
static napi_value tryWriter(napi_env e, napi_callback_info ci) { return safe(e, [&] {
  auto a = args(e, ci, 1); auto* s = state(e); auto p = probePath(s, string(e, a[0]));
  try { auto* l = probeOpen(s, p, GENERIC_WRITE | FILE_READ_ATTRIBUTES); if (!closeLease(s, l)) throw Fault{ "CloseHandle_probe", ERROR_INVALID_HANDLE }; return number(e, 0); }
  catch (const Fault& f) { if (std::strcmp(f.api, "CreateFileW_probe") == 0) return number(e, f.code); throw; }
}); }
static napi_value tryRename(napi_env e, napi_callback_info ci) { return safe(e, [&] {
  auto a = args(e, ci, 2); auto* s = state(e); auto from = probePath(s, string(e, a[0])), to = probePath(s, string(e, a[1]));
  // No replacement/copy flags. Source/target are trusted, fixed fixture children.
  if (MoveFileExW(from.c_str(), to.c_str(), 0)) return number(e, 0); return number(e, GetLastError());
}); }
static napi_value setJunction(napi_env e, napi_callback_info ci) { return safe(e, [&] {
  auto a = args(e, ci, 2); auto* s = state(e); auto link = probePath(s, string(e, a[0])), target = probePath(s, string(e, a[1]));
  auto* t = probeOpen(s, target, FILE_READ_ATTRIBUTES); FILE_ATTRIBUTE_TAG_INFO attr{};
  try { win(GetFileInformationByHandleEx(t->value, FileAttributeTagInfo, &attr, sizeof(attr)) != 0, "probe_target_info");
    if (!(attr.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) || (attr.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)) throw Fault{ "probe_target", ERROR_INVALID_DATA };
  } catch (...) { closeLease(s, t); throw; } if (!closeLease(s, t)) throw Fault{ "CloseHandle_probe", ERROR_INVALID_HANDLE };
  Lease* l = nullptr;
  try { l = probeOpen(s, link, GENERIC_WRITE | FILE_READ_ATTRIBUTES); }
  catch (const Fault& f) { if (std::strcmp(f.api, "CreateFileW_probe") == 0) return number(e, f.code); throw; }
  // Documented mount-point REPARSE_DATA_BUFFER wire layout, not a WDK dependency.
  auto substitute = L"\\??\\" + target; auto printable = target;
  size_t subBytes = substitute.size() * 2, printBytes = printable.size() * 2;
  std::vector<unsigned char> buffer(16 + subBytes + 2 + printBytes + 2, 0);
  auto word = [&](size_t at, USHORT v) { std::memcpy(buffer.data() + at, &v, sizeof(v)); };
  DWORD tag = IO_REPARSE_TAG_MOUNT_POINT; std::memcpy(buffer.data(), &tag, sizeof(tag));
  word(4, static_cast<USHORT>(buffer.size() - 8)); word(8, 0); word(10, static_cast<USHORT>(subBytes)); word(12, static_cast<USHORT>(subBytes + 2)); word(14, static_cast<USHORT>(printBytes));
  std::memcpy(buffer.data() + 16, substitute.data(), subBytes); std::memcpy(buffer.data() + 16 + subBytes + 2, printable.data(), printBytes);
  DWORD returned = 0; bool ok = DeviceIoControl(l->value, FSCTL_SET_REPARSE_POINT, buffer.data(), static_cast<DWORD>(buffer.size()), nullptr, 0, &returned, nullptr) != 0;
  DWORD result = ok ? 0 : GetLastError(); if (ok) s->junctions.insert(lower(link));
  if (!closeLease(s, l)) throw Fault{ "CloseHandle_probe", ERROR_INVALID_HANDLE }; return number(e, result);
}); }
static napi_value removeJunction(napi_env e, napi_callback_info ci) { return safe(e, [&] {
  auto a = args(e, ci, 1); auto* s = state(e); auto p = probePath(s, string(e, a[0]));
  if (!s->junctions.count(lower(p))) throw Fault{ "unowned_junction", ERROR_ACCESS_DENIED };
  auto* l = probeOpen(s, p, GENERIC_WRITE | FILE_READ_ATTRIBUTES); FILE_ATTRIBUTE_TAG_INFO attr{};
  try { win(GetFileInformationByHandleEx(l->value, FileAttributeTagInfo, &attr, sizeof(attr)) != 0, "probe_link_info");
    if (attr.ReparseTag != IO_REPARSE_TAG_MOUNT_POINT) throw Fault{ "unexpected_reparse", ERROR_INVALID_DATA };
    unsigned char data[8]{}; DWORD tag = IO_REPARSE_TAG_MOUNT_POINT, returned = 0; std::memcpy(data, &tag, sizeof(tag));
    win(DeviceIoControl(l->value, FSCTL_DELETE_REPARSE_POINT, data, sizeof(data), nullptr, 0, &returned, nullptr) != 0, "FSCTL_DELETE_REPARSE_POINT");
  } catch (...) { closeLease(s, l); throw; }
  if (!closeLease(s, l)) throw Fault{ "CloseHandle_probe", ERROR_INVALID_HANDLE };
  win(RemoveDirectoryW(p.c_str()) != 0, "RemoveDirectoryW_link"); s->junctions.erase(lower(p)); return undef(e);
}); }
#endif
static void dispose(napi_env, void* data, void*) {
  auto* box = static_cast<std::shared_ptr<State>*>(data); auto* s = box->get();
  // External finalizers may run before or after instance-data finalization. Their
  // shared owner keeps state/ledger alive; never free an externally referenced Lease.
  for (auto i = s->leases.begin(); i != s->leases.end();) {
    auto* l = *i; bool ok = false;
    try { ok = closeLease(s, l); } catch (...) { if (l->value != INVALID_HANDLE_VALUE && CloseHandle(l->value)) l->value = INVALID_HANDLE_VALUE; ok = l->value == INVALID_HANDLE_VALUE; }
    if (ok && !l->externalBound) { i = s->leases.erase(i); delete l; } else ++i;
  }
  delete box;
}
static napi_value init(napi_env e, napi_value exports) { return safe(e, [&] {
  auto owner = std::make_shared<State>(); auto* s = owner.get(); s->events.reserve(4096); s->leases.reserve(1024); auto module = GetModuleHandleW(L"ntdll.dll");
  s->create = reinterpret_cast<NtCreate>(module ? GetProcAddress(module, "NtCreateFile") : nullptr);
  if (!s->create) throw Fault{ "NtCreateFile_unavailable", ERROR_PROC_NOT_FOUND };
  auto* box = new std::shared_ptr<State>(owner);
  if (napi_set_instance_data(e, box, dispose, nullptr) != napi_ok) { delete box; throw Fault{ "node_instance_data", ERROR_INVALID_DATA }; }
  auto method = [&](const char* name, napi_callback cb) { napi_value fn; check(napi_create_function(e, name, NAPI_AUTO_LENGTH, cb, nullptr, &fn)); set(e, exports, name, fn); };
  method("openVolumeRoot", openRoot); method("openDirectory", openDirectory); method("createDirectory", createDirectory); method("createFile", createFile);
  method("info", info); method("assertLocalNtfs", assertVolume); method("close", close); method("closeAll", closeAll); method("audit", audit);
#ifdef FOLDER_FIXTURE_PROBES
  method("configureFixture", configure); method("tryWriter", tryWriter); method("tryRename", tryRename); method("setJunction", setJunction); method("removeJunction", removeJunction);
#endif
  set(e, exports, "candidateOnly", boolean(e, true)); set(e, exports, "policyVersion", number(e, 2)); return exports;
}); }
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
