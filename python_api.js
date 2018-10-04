define(['base/js/namespace'], 
	function(Jupyter){
		function load_ipython_extension(){
			alert("JKL");
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
			
			var code_exec_callback = function(msg){
				var d = JSON.parse(msg.content.text.trim());
				alert(d);
			};

			var cmd = 'print(json.dumps("abc"))';
			Jupyter.notebook.kernel.execute(cmd, { iopub: { output: code_exec_callback } }, { silent: false });

			console.log("ABC ", Jupyter.notebook);
			alert("DEF");
		}
		return {
			load_ipython_extension: load_ipython_extension
		};
	}
);
