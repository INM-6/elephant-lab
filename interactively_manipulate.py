define(['base/js/namespace', 'jquery'], 
	function(Jupyter){
		function init_py(){
			var src = Jupyter.notebook.base_url + "nbextensions/new_ext/test.py"
			$.get(src)
				.done(function(data){
					Jupyter.notebook.kernel.execute(data);
					console.log("Loading Python finished:");
				})
				.fail(function(){
					console.log("Loading Python failed:");
				});
		}

		function show_res(data){
			console.log(data);
			var d = JSON.parse(data.content.text.trim());
			console.log(d);
			if(d.length > 1){
				Jupyter.notebook.kernel.execute('del ' + d[0]);
				Jupyter.notebook.kernel.execute('blchidx0.analogsignals.append(blchidx1.analogsignals[0])');
			}
			console.log("AAA");
		}
		function update(kernel){
			Jupyter.notebook.kernel.execute('print(testfunc())', {iopub: {output: show_res}});
		}


		function load_ipython_extension(){
			init_py();
			//update(Jupyter.notebook.kernel);
			//events.on('execute.CodeCell', update); 
			alert("Hello World!");
			var handler = function(){
				alert("GHI");
			};

			var action = {
				icon: 'fa-comments-o',
				help: ' Show alert',
				handler: handler
			};

			var full_action_name = Jupyter.actions.register(action, 'ghi', 'new_ext');
			Jupyter.toolbar.add_buttons_group([full_action_name]);

			var handler_del = function(){
				Jupyter.notebook.kernel.execute('del data');
			}
			var action_del = {
				icon: 'fa-window-close-o',
				help: 'Delete data',
				handler: handler_del
			}
			var full_action_name_del = Jupyter.actions.register(action_del, 'del', 'new_ext');
			Jupyter.toolbar.add_buttons_group([full_action_name_del]);
			
			var code_exec_callback = function(msg){
				var d = JSON.parse(msg.content.text.trim());
				alert(d);
			};

			//var cmd = 'print(json.dumps("abc"))';
			//Jupyter.notebook.kernel.execute(cmd, { iopub: { output: code_exec_callback } }, { silent: false });
			
			update(Jupyter.notebook.kernel);
			Jupyter.notebook.events.on('execute.CodeCell', update);

			//console.log(Jupyter.notebook);
		}
		return {
			load_ipython_extension: load_ipython_extension
		};
	}
);
