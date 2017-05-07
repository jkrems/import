#include <nan.h>

#include <map>
#include <string>
#include <vector>

class ModuleWrap : public Nan::ObjectWrap {
  public:
    static NAN_MODULE_INIT(Init);

  private:
    explicit ModuleWrap(v8::Local<v8::Module> value, v8::Local<v8::String> url);
    ~ModuleWrap();

    static NAN_METHOD(New);
    static NAN_METHOD(Link);
    static NAN_METHOD(Instantiate);
    static NAN_METHOD(Evaluate);
    static NAN_GETTER(GetUrl);
    static NAN_GETTER(GetRequests);
    static v8::MaybeLocal<v8::Module> ResolveCallback(v8::Local<v8::Context> context,
                                                      v8::Local<v8::String> specifier,
                                                      v8::Local<v8::Module> referrer);

    Nan::Persistent<v8::Module> module_;
    Nan::Persistent<v8::String> url_;
    std::map<std::string, Nan::Persistent<v8::Promise>*> resolve_cache_;

    static Nan::Persistent<v8::Function> constructor;
    static std::map<int, std::vector<ModuleWrap*>*> module_map_;
};

Nan::Persistent<v8::Function> ModuleWrap::constructor;
std::map<int, std::vector<ModuleWrap*>*> ModuleWrap::module_map_;

ModuleWrap::ModuleWrap(v8::Local<v8::Module> value, v8::Local<v8::String> url) {
  module_.Reset(value);
  url_.Reset(url);
}

ModuleWrap::~ModuleWrap() {
  auto module = module_.Get(v8::Isolate::GetCurrent());
  auto same_hash = module_map_[module->GetIdentityHash()];
  auto it = std::find(same_hash->begin(), same_hash->end(), this);
  if (it != same_hash->end()) {
    same_hash->erase(it);
  }
  module_.Reset();
}

NAN_METHOD(ModuleWrap::New) {
  auto iso = info.GetIsolate();
  if (!info.IsConstructCall()) {
    Nan::ThrowError("constructor must be called using new");
    return;
  }
  if (info.Length() != 2) {
    Nan::ThrowError("constructor must have exactly 2 argument (string, string)");
    return;
  }

  if (!info[0]->IsString()) {
    Nan::ThrowError("first argument is not a string");
    return;
  }
  auto arg = Nan::To<v8::String>(info[0]).ToLocalChecked();
  v8::String::Utf8Value source_text(arg);

  if (!info[1]->IsString()) {
    Nan::ThrowError("second argument is not a string");
    return;
  }
  auto url = Nan::To<v8::String>(info[1]).ToLocalChecked();

  v8::Local<v8::Module> mod;
  // compile
  {
    // TODO: ask v8 about when it is safe to destruct
    v8::ScriptOrigin origin(url,
                            v8::Integer::New(iso, 0),
                            v8::Integer::New(iso, 0),
                            v8::False(iso),
                            v8::Integer::New(iso, 0),
                            v8::String::NewFromUtf8(iso, ""),
                            v8::False(iso),
                            v8::False(iso),
                            v8::True(iso));
    v8::ScriptCompiler::Source source(arg, origin);
    {
      v8::TryCatch compileCatch(iso);
      auto maybe_mod = v8::ScriptCompiler::CompileModule(iso, &source);
      if (compileCatch.HasCaught()) {
        compileCatch.ReThrow();
        return;
      }
      mod = maybe_mod.ToLocalChecked();
    }
  }
  ModuleWrap* obj = new ModuleWrap(mod, url);
  if (ModuleWrap::module_map_.count(mod->GetIdentityHash()) == 0) {
    ModuleWrap::module_map_[mod->GetIdentityHash()] = new std::vector<ModuleWrap*>();
  }
  ModuleWrap::module_map_[mod->GetIdentityHash()]->push_back(obj);

  obj->Wrap(info.This());

  info.GetReturnValue().Set(info.This());
}

NAN_METHOD(ModuleWrap::Link) {
  if (!info[0]->IsFunction()) {
    Nan::ThrowError("first argument is not a function");
    return;
  }
  Nan::Callback* resolverArg = new Nan::Callback(info[0].As<v8::Function>());

  ModuleWrap* obj = Nan::ObjectWrap::Unwrap<ModuleWrap>(info.This());
  v8::Local<v8::Module> mod = Nan::New(obj->module_);

  // call the dependency resolve callbacks
  for (auto i = 0; i < mod->GetModuleRequestsLength(); i++) {

    auto specifier = mod->GetModuleRequest(i);
    v8::String::Utf8Value utf8_specifier(specifier);
    std::string std_specifier = *utf8_specifier;

    v8::Local<v8::Value> argv[] = {
      info.This(),
      specifier
    };

    v8::Local<v8::Value> resolveReturnValue = resolverArg->Call(2, argv);
    v8::Local<v8::Promise> resolvePromise = v8::Local<v8::Promise>::Cast(resolveReturnValue);
    obj->resolve_cache_[std_specifier] = new Nan::Persistent<v8::Promise>(resolvePromise);
  }

  info.GetReturnValue().Set(info.This());
}

NAN_GETTER(ModuleWrap::GetUrl) {
  ModuleWrap* obj = Nan::ObjectWrap::Unwrap<ModuleWrap>(info.This());
  v8::Local<v8::String> url = Nan::New(obj->url_);
  info.GetReturnValue().Set(url);
}

NAN_GETTER(ModuleWrap::GetRequests) {
  ModuleWrap* obj = Nan::ObjectWrap::Unwrap<ModuleWrap>(info.This());
  v8::Local<v8::Module> mod = Nan::New(obj->module_);

  auto len = mod->GetModuleRequestsLength();
  v8::Local<v8::Array> requests = Nan::New<v8::Array>(len);

  for (auto i = 0; i < len; i++) {
    requests->Set(i, mod->GetModuleRequest(i));
  }

  info.GetReturnValue().Set(requests);
}

NAN_METHOD(ModuleWrap::Instantiate) {
  auto iso = info.GetIsolate();

  ModuleWrap* obj = Nan::ObjectWrap::Unwrap<ModuleWrap>(info.This());
  v8::TryCatch linkCatch(iso);
  auto ok = obj->module_.Get(iso)->Instantiate(iso->GetCurrentContext(), ModuleWrap::ResolveCallback);

  // clear resolve cache on instantiate
  obj->resolve_cache_.clear();

  if (linkCatch.HasCaught()) {
    linkCatch.ReThrow();
    return;
  }
  if (!ok) {
    Nan::ThrowError("linking error, ??");
    return;
  }
}

NAN_METHOD(ModuleWrap::Evaluate) {
  auto iso = info.GetIsolate();
  ModuleWrap* obj = Nan::ObjectWrap::Unwrap<ModuleWrap>(info.This());
  v8::TryCatch evalCatch(iso);
  auto result = obj->module_.Get(iso)->Evaluate(iso->GetCurrentContext());
  if (evalCatch.HasCaught()) {
    evalCatch.ReThrow();
    return;
  }
  auto ret = result.ToLocalChecked();
  info.GetReturnValue().Set(ret);
}

v8::MaybeLocal<v8::Module> ModuleWrap::ResolveCallback(v8::Local<v8::Context> context,
                                           v8::Local<v8::String> specifier,
                                           v8::Local<v8::Module> referrer) {
  if (ModuleWrap::module_map_.count(referrer->GetIdentityHash()) == 0) {
    Nan::ThrowError("linking error, unknown module");
    return v8::MaybeLocal<v8::Module>();
  }

  auto possible_deps = ModuleWrap::module_map_[referrer->GetIdentityHash()];
  ModuleWrap* dependent = nullptr;

  for (auto possible_dep : *possible_deps) {
    if (possible_dep->module_ == referrer) {
      dependent = possible_dep;
    }
  }

  v8::String::Utf8Value ss(specifier);

  if (dependent == nullptr) {
    Nan::ThrowError("linking error, null dep");
    return v8::MaybeLocal<v8::Module>();
  }

  v8::String::Utf8Value utf8_specifier(specifier);
  std::string std_specifier = *utf8_specifier;

  if (dependent->resolve_cache_.count(std_specifier) != 1) {
    Nan::ThrowError("linking error, not in local cache");
    return v8::MaybeLocal<v8::Module>();
  }

  v8::Local<v8::Promise> resolvePromise = Nan::New(*dependent->resolve_cache_[std_specifier]);

  if (resolvePromise->State() != v8::Promise::kFulfilled) {
    Nan::ThrowError("linking error, dependency promises must be resolved on instantiate");
    return v8::MaybeLocal<v8::Module>();
  }

  v8::MaybeLocal<v8::Object> moduleObject = Nan::To<v8::Object>(resolvePromise->Result());

  if (moduleObject.IsEmpty()) {
    Nan::ThrowError("linking error, expected a valid module object from resolver");
    return v8::MaybeLocal<v8::Module>();
  }

  ModuleWrap* mod = Nan::ObjectWrap::Unwrap<ModuleWrap>(moduleObject.ToLocalChecked());

  return mod->module_.Get(context->GetIsolate());
}

NAN_MODULE_INIT(ModuleWrap::Init) {
  v8::Local<v8::FunctionTemplate> tpl = Nan::New<v8::FunctionTemplate>(New);
  tpl->SetClassName(Nan::New("ModuleWrap").ToLocalChecked());
  tpl->InstanceTemplate()->SetInternalFieldCount(1);

  Nan::SetAccessor(tpl->InstanceTemplate(), Nan::New("url").ToLocalChecked(), GetUrl);
  Nan::SetAccessor(tpl->InstanceTemplate(), Nan::New("requests").ToLocalChecked(), GetRequests);

  Nan::SetPrototypeMethod(tpl, "link", Link);
  Nan::SetPrototypeMethod(tpl, "instantiate", Instantiate);
  Nan::SetPrototypeMethod(tpl, "evaluate", Evaluate);

  constructor.Reset(Nan::GetFunction(tpl).ToLocalChecked());
  Nan::Set(target, Nan::New("ModuleWrap").ToLocalChecked(), Nan::GetFunction(tpl).ToLocalChecked());
}

NODE_MODULE(node_import, ModuleWrap::Init)
