// hello.cc
#include <map>
#include <string>

#include <nan.h>

namespace demo {

using namespace v8;

class ModuleRecord : public Nan::ObjectWrap {
public:
  static NAN_MODULE_INIT(Init) {
    v8::Local<v8::FunctionTemplate> tpl = Nan::New<v8::FunctionTemplate>(New);
    tpl->SetClassName(Nan::New("ModuleRecord").ToLocalChecked());
    tpl->InstanceTemplate()->SetInternalFieldCount(1);

    Nan::SetPrototypeMethod(tpl, "run", Run);

    constructor().Reset(Nan::GetFunction(tpl).ToLocalChecked());
    Nan::Set(target, Nan::New("ModuleRecord").ToLocalChecked(), Nan::GetFunction(tpl).ToLocalChecked());
  }

private:
  Nan::Persistent<Module> module_;

  ModuleRecord() {}
  ~ModuleRecord() {}

  static NAN_METHOD(New) {
    if (!info.IsConstructCall()) {
      return Nan::ThrowTypeError("Must call ModuleRecord as a constructor.");
    }
    ModuleRecord *record = new ModuleRecord();
    record->Wrap(info.This());

    Local<String> filename(info[0].As<v8::String>());
    Local<String> source_text(info[1].As<v8::String>());

    ScriptOrigin origin(filename);
    ScriptCompiler::Source source(source_text, origin);

    Local<Module> module;
    if (!ScriptCompiler::CompileModule(info.GetIsolate(), &source).ToLocal(&module)) {
      // TODO: handle error
      return;
    }

    int request_count = module->GetModuleRequestsLength();
    Local<Array> requests = Nan::New<Array>(request_count);
    for (int i = 0; i < request_count; ++i) {
      Local<String> name = module->GetModuleRequest(i);
      Nan::Set(requests, i, name);
    }

    Nan::Set(info.This(), Nan::New<String>("filename").ToLocalChecked(), filename);
    Nan::Set(info.This(), Nan::New<String>("source").ToLocalChecked(), source_text);
    Nan::Set(info.This(), Nan::New<String>("requests").ToLocalChecked(), requests);
    Nan::Set(info.This(), Nan::New<String>("resolved").ToLocalChecked(), Nan::New<Object>());

    record->module_.Reset(module); // TODO: make weak so we don't leak memory?
    module->SetEmbedderData(info.This());

    info.GetReturnValue().Set(info.This());
  }

  static MaybeLocal<Module> ResolveModuleCallback(Local<Context> context,
                                                  Local<String> specifier,
                                                  Local<Module> referrer,
                                                  Local<Value> data) {
    TryCatch try_catch(context->GetIsolate());
    Nan::Callback resolver(data.As<v8::Function>());

    Local<Value> referrer_value = referrer->GetEmbedderData();

    Local<Value> resolver_args[] = { specifier, referrer_value };
    Local<Value> resolved = resolver(2, resolver_args);
    if (try_catch.HasCaught()) {
      printf("Resolving the module failed! This should not happen.\n");
      try_catch.ReThrow();
      return MaybeLocal<Module>();
    }
    Local<Object> resolved_obj = resolved.As<Object>();
    ModuleRecord* record = Nan::ObjectWrap::Unwrap<ModuleRecord>(resolved_obj);
    return Nan::New(record->module_);
  }

  static NAN_METHOD(Run) {
    ModuleRecord* record = Nan::ObjectWrap::Unwrap<ModuleRecord>(info.Holder());
    Local<Module> module = Nan::New(record->module_);

    TryCatch try_catch(info.GetIsolate());
    MaybeLocal<Value> maybe_result;
    {
      Local<Context> realm = Nan::GetCurrentContext();
      Context::Scope context_scope(realm);

      if (!module->Instantiate(realm, ResolveModuleCallback, info[0])) {
        // ReportException?
        return;
      }
      maybe_result = module->Evaluate(realm);
      // EmptyMessageQueues(isolate);
    }

    if (try_catch.HasCaught()) {
      try_catch.ReThrow();
      return;
    }

    info.GetReturnValue().Set(maybe_result.ToLocalChecked());
  }

  static inline Nan::Persistent<Function> & constructor() {
    static Nan::Persistent<Function> my_constructor;
    return my_constructor;
  }
};

NAN_MODULE_INIT(InitAll) {
  ModuleRecord::Init(target);
}

NODE_MODULE(addon, InitAll)

}  // namespace demo
