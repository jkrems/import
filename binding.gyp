{
  "targets": [
    {
      "target_name": "module_wrap",
      "sources": [ "src/module_wrap.cc" ],
      "include_dirs" : [
        "<!(node -e \"require('nan')\")",
      ],
    }
  ]
}
